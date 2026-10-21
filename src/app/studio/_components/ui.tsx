'use client';

import { animate, AnimatePresence, motion, useIsPresent, useMotionValue, useTransform, type Variants } from 'framer-motion';
import {
  createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState,
  type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import type { HuePalette } from '@/lib/studio/character';
import type { CharacterLook } from '@/lib/studio/types';
import { privacyCopy } from '../_lib/adaptive-copy';
import { haptic } from '../_lib/haptics';
import { DUR, EASE, SPRING } from '../_lib/motion';
import { tg } from '../_lib/client';
import { Cloud, type Expression } from './Cloud';
import { useTier } from './motion/tier';
import { useNav } from './StudioApp';

/* ---------- icons (24 grid, 1.75 stroke, round caps; UI §1.4) ---------- */

const STROKE = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.75, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

const PATHS: Record<string, string> = {
  back: 'M15 5l-7 7 7 7',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z',
  close: 'M6 6l12 12M18 6L6 18',
  plus: 'M12 5v14M5 12h14',
  cloud: 'M7 17a4 4 0 0 1-.5-7.97A5.5 5.5 0 0 1 17.3 8.5 4.25 4.25 0 0 1 17 17Z',
  phone: 'M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2',
  groups: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7M2.5 20a6.5 6.5 0 0 1 13 0M16 4.3a3.5 3.5 0 0 1 0 6.4M18.5 14a6.5 6.5 0 0 1 3 6',
  shield: 'M12 3l8 4v5c0 4.5-3.4 8.4-8 9-4.6-.6-8-4.5-8-9V7Z',
  chat: 'M4 5h16v11H9l-5 4Z',
  memory: 'M12 3a6 6 0 0 0-4 10.5V17h8v-3.5A6 6 0 0 0 12 3ZM9 21h6',
  spark: 'M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6',
  send: 'M12 19V5M5 12l7-7 7 7',
  mic: 'M9 3h6v11H9zM5 11a7 7 0 0 0 14 0M12 18v3',
  micOff: 'M9 3h6v11H9zM5 11a7 7 0 0 0 14 0M12 18v3M4 4l16 16',
  play: 'M7 4l13 8-13 8Z',
  pause: 'M7 5h3v14H7zM14 5h3v14h-3z',
  lock: 'M5 11h14v10H5zM8 11V8a4 4 0 0 1 8 0v3',
  dice: 'M4 4h16v16H4zM8.5 8.5h.01M15.5 15.5h.01M15.5 8.5h.01M8.5 15.5h.01M12 12h.01',
  upload: 'M12 16V4M7 9l5-5 5 5M4 20h16',
  image: 'M4 4h16v16H4zM4 16l5-5 4 4 3-3 4 4M15 8.5h.01',
  check: 'M5 12.5l4.5 4.5L19 7',
  warn: 'M12 3l9 16H3ZM12 10v4M12 17h.01',
  trash: 'M4 7h16M10 7V4h4v3M6 7l1 13h10l1-13',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8M4 21a8 8 0 0 1 16 0',
  captions: 'M3 5h18v14H3zM10 10.5a2 2 0 1 0 0 3M17 10.5a2 2 0 1 0 0 3',
  end: 'M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14M20 20l-3.5-3.5',
  chevronDown: 'M6 9l6 6 6-6',
  forward: 'M9 5l7 7-7 7',
  signal: 'M2 9a15 15 0 0 1 20 0M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M12 19.5h.01',
  userPlus: 'M9 11.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7M2.5 20a6.5 6.5 0 0 1 13 0M19 8v6M16 11h6',
  list: 'M4 6h16M4 12h10M4 18h6',
  inbox: 'M3 13h5l1.5 3h5L16 13h5M5 5h14l2 8v6H3v-6Z',
  attach: 'M20 11.5l-8.3 8.3a5 5 0 0 1-7-7L13 4.5a3.3 3.3 0 0 1 4.7 4.7L9.4 17.5a1.7 1.7 0 0 1-2.4-2.4l7.6-7.6',
  bell: 'M6 16V11a6 6 0 0 1 12 0v5l2 2H4ZM10 21h4',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M12 7v5l3 2',
  globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18',
  plug: 'M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0ZM12 17v4',
  download: 'M12 4v12M7 11l5 5 5-5M4 20h16',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M12 11v5M12 8h.01',
  sliders: 'M4 7h10M18 7h2M4 17h4M12 17h8M16 5v4M10 15v4',
  edit: 'M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16ZM13.5 6.5l4 4',
  external: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  refresh: 'M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6',
  minus: 'M5 12h14',
  telegram: 'M21 4L3 11.5l6 2M21 4l-3.5 16L9 13.5M21 4L9 13.5V19l3.2-3.4',
  /** Points to the inline end; mirrors in RTL (DIRECTIONAL). */
  chevron: 'M6 9l6 6 6-6',
  chevronEnd: 'M9 6l6 6-6 6',
};

/** Icons that point somewhere and therefore mirror in RTL. */
const DIRECTIONAL = new Set(['back', 'forward', 'external', 'chevronEnd']);

export type IconName = keyof typeof PATHS | 'more';

export function Icon({ name, size = 22, width = 1.75, style, flip, className }: {
  name: IconName | string; size?: number; width?: number; style?: CSSProperties; flip?: boolean; className?: string;
}) {
  const cls = [className, (flip ?? DIRECTIONAL.has(name)) && 'vx-flip'].filter(Boolean).join(' ') || undefined;
  if (name === 'more') {
    // Board: three filled dots (r 1.8), not stroked points
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={style} className={cls}>
        <circle cx="5" cy="12" r="1.8" fill="currentColor" /><circle cx="12" cy="12" r="1.8" fill="currentColor" /><circle cx="19" cy="12" r="1.8" fill="currentColor" />
      </svg>
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...STROKE} strokeWidth={width} aria-hidden="true" style={style} className={cls}>
      <path d={PATHS[name] ?? ''} />
    </svg>
  );
}

export function Spinner({ size = 18 }: { size?: number }) {
  return (
    <svg className="vx-spin" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity=".25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/* ---------- locale for the primitives' own words ---------- */

type UiLocale = 'en' | 'fa';
const UiLocaleContext = createContext<UiLocale>('en');
/** StudioApp provides nav.locale, so the primitives' defaults (Back, Try again, Cancel…) follow the app language. */
export const UiLocaleProvider = UiLocaleContext.Provider;
const useUiCopy = () => UI_COPY[useContext(UiLocaleContext)];
const UI_COPY = {
  en: {
    lead: { back: 'Back', close: 'Close', down: 'Minimise' }, retry: 'Try again', choose: 'Choose', chosen: 'Chosen',
    search: 'Search', nothingMatches: 'Nothing matches', keep: 'Keep', cancel: 'Cancel', confirm: 'Confirm', loading: 'Loading',
    step: (n: number, total: number) => `Step ${n} of ${total}`,
  },
  fa: {
    lead: { back: 'بازگشت', close: 'بستن', down: 'کوچک کردن' }, retry: 'تلاش دوباره', choose: 'انتخاب', chosen: 'انتخاب شد',
    search: 'جستجو', nothingMatches: 'موردی پیدا نشد', keep: 'نگه‌داشتن', cancel: 'انصراف', confirm: 'تأیید', loading: 'در حال بارگذاری',
    step: (n: number, total: number) => `مرحلهٔ ${n.toLocaleString('fa-IR')} از ${total.toLocaleString('fa-IR')}`,
  },
} as const;

/* ---------- top bar · page head · steps ---------- */

const LEAD_ICON = { back: 'back', close: 'close', down: 'chevronDown' } as const;

export interface TopBarProps {
  /** Leading control; the back chevron mirrors in RTL */
  lead?: 'back' | 'close' | 'down';
  onLead?: () => void;
  /** Visible text after the back chevron ("‹ Aria"), also the button's name */
  leadLabel?: string;
  title?: ReactNode;
  subtitle?: ReactNode;
  end?: ReactNode;
  /** v1 aliases: onBack → lead 'back' + onLead, backLabel → leadLabel, right → end */
  onBack?: () => void;
  backLabel?: string;
  right?: ReactNode;
}

/**
 * Both side tracks share one minimum (`--tb-side`): the end actions' width, or the back label's
 * natural width up to a third of the bar. The `auto` title track would otherwise grow to its full
 * text first and squeeze the sides to 44px, so the actions spill over the subtitle. `lead` keys the
 * effect: a lead appearing swaps the start element the observer watches.
 */
function useTopBarSides(bar: RefObject<HTMLDivElement | null>, lead: string) {
  useLayoutEffect(() => {
    const el = bar.current;
    if (!el) return;
    const fit = () => {
      const start = el.children[0] as HTMLElement | undefined;
      const end = el.children[2] as HTMLElement | undefined;
      if (!start || !end) return;
      // The label ellipsizes inside its track, so add back what it hides to get the natural width
      const text = start.querySelector('span');
      const startW = start.offsetWidth + (text ? Math.max(0, text.scrollWidth - text.clientWidth) : 0);
      const cs = getComputedStyle(el);
      const room = el.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0) - 2 * (parseFloat(cs.columnGap) || 0);
      const side = Math.ceil(Math.max(44, end.scrollWidth, Math.min(startW, room / 3)));
      if (el.style.getPropertyValue('--tb-side') !== `${side}px`) el.style.setProperty('--tb-side', `${side}px`);
    };
    fit();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    for (const c of Array.from(el.children)) ro.observe(c);
    return () => ro.disconnect();
  }, [bar, lead]);
}

/** Pinned top bar: a 3-column grid, so the title stays centred whatever sits on either side. */
export function TopBar({ lead, onLead, leadLabel, title, subtitle, end, onBack, backLabel, right }: TopBarProps) {
  const kind = lead ?? (onBack ? 'back' : undefined);
  const go = onLead ?? onBack;
  const text = kind === 'back' ? leadLabel ?? backLabel : undefined;
  const copy = useUiCopy();
  const bar = useRef<HTMLDivElement>(null);
  useTopBarSides(bar, `${kind && go ? kind : ''}:${text ?? ''}`);
  return (
    <div ref={bar} className="vx-topbar">
      {kind && go ? (
        <button type="button" className={`vx-back${text ? '' : ' icon'}`} onClick={go} aria-label={leadLabel ?? backLabel ?? copy.lead[kind]}>
          <Icon name={LEAD_ICON[kind]} />{text && <span>{text}</span>}
        </button>
      ) : <span />}
      <div className="vx-topbar-title">
        {title != null && title !== false && <div>{title}</div>}
        {subtitle != null && subtitle !== false && <div>{subtitle}</div>}
      </div>
      <div>{end ?? right}</div>
    </div>
  );
}

/** Tab-root header: overline, Display title, optional trailing slot. */
export function PageHead({ over, title, end }: { over?: ReactNode; title: ReactNode; end?: ReactNode }) {
  return (
    <div className="vx-pagehead">
      {over && <span className="vx-over">{over}</span>}
      <div className="vx-pagehead-row">
        <h1 className="vx-display">{title}</h1>
        {end}
      </div>
    </div>
  );
}

/** Progress dots: volt, always (the boards keep them volt once a draft has a hue). */
export function Steps({ total, current }: { total: number; current: number }) {
  const reduced = useTier() === 'reduced';
  const copy = useUiCopy();
  return (
    <div className="vx-steps" role="img" aria-label={copy.step(current + 1, total)}>
      {Array.from({ length: total }, (_, i) => (
        <motion.span key={i} className={i <= current ? 'on' : undefined} initial={false}
          animate={{ width: i === current ? 20 : 8 }} transition={reduced ? { duration: 0 } : SPRING.snappy} />
      ))}
    </div>
  );
}

/* ---------- sheet (motion §3.6, interaction §7) ---------- */

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const DISMISS_OFFSET = 120;
const DISMISS_VELOCITY = 800;
/** Open sheets, newest last: only the top one answers Escape and traps focus. */
const openSheets: string[] = [];

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  /** Accessible name of the dialog */
  label: string;
  /** Pinned under the scrolling body (a sheet's single CTA) */
  dock?: ReactNode;
  /** Where focus lands on open; default the sheet itself, so no keyboard pops up */
  initialFocus?: RefObject<HTMLElement | null>;
  /** Above other sheets (confirmations) */
  layer?: 'top';
}

/**
 * Bottom sheet. Springs in on SPRING.sheet; drags down from the grabber, or from the body when it is
 * scrolled to the top, and hands its release velocity to the spring. Focus trap, Escape, focus return.
 */
export function Sheet(props: SheetProps) {
  const host = useContext(SheetHostContext);
  const sheet = <AnimatePresence>{props.open && <SheetPanel {...props} />}</AnimatePresence>;
  if (host === undefined) return sheet;
  // Inside a screen: every sheet sits at the screen's root, so one opened from inside another sheet
  // covers the screen instead of the parent panel. The host exists before the first paint.
  return host ? createPortal(sheet, host) : null;
}

/**
 * Where a screen's sheets mount (StudioApp gives each screen one). Undefined outside a screen: the
 * sheet renders in place. Null while the screen's element is not attached yet.
 */
export const SheetHostContext = createContext<HTMLElement | null | undefined>(undefined);

const rubber = (dy: number) => (dy >= 0 ? dy : -Math.min(14, Math.sqrt(-dy) * 2));

function SheetPanel({ onClose, children, label, dock, initialFocus, layer }: SheetProps) {
  const id = useId();
  const present = useIsPresent();
  const reduced = useTier() === 'reduced';
  const panel = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const y = useMotionValue(0);
  const dim = useTransform(y, (v) => 1 - Math.min(Math.max(v, 0) / ((panel.current?.offsetHeight ?? 600) * 1.4), 0.7));
  const gesture = useRef<{ id: number; x: number; y: number; grab: boolean; active: boolean } | null>(null);

  // Open: remember the trigger, take focus, keep Telegram's swipe-to-close out of the drag.
  useLayoutEffect(() => {
    returnTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    openSheets.push(id);
    tg()?.disableVerticalSwipes?.();
    (initialFocus?.current ?? panel.current)?.focus({ preventScroll: true });
    return () => { const i = openSheets.indexOf(id); if (i >= 0) openSheets.splice(i, 1); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Close starts: leave the stack and give focus back right away, not after the exit spring.
  useEffect(() => {
    if (present) return;
    const i = openSheets.indexOf(id);
    if (i >= 0) openSheets.splice(i, 1);
    const back = returnTo.current;
    if (back?.isConnected && (!document.activeElement || document.activeElement === document.body || panel.current?.contains(document.activeElement))) {
      back.focus({ preventScroll: true });
    }
  }, [present, id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (openSheets[openSheets.length - 1] !== id) return;
      if (e.key === 'Escape') { e.stopPropagation(); close.current(); return; }
      if (e.key !== 'Tab' || !panel.current) return;
      const items = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (!items.length) { e.preventDefault(); panel.current.focus(); return; }
      const first = items[0], last = items[items.length - 1];
      const at = document.activeElement;
      if (e.shiftKey && (at === first || at === panel.current)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (at === last || !panel.current.contains(at))) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [id]);

  // Touch: once a drag is ours, stop the browser from scrolling or rubber-banding the body underneath.
  useEffect(() => {
    const el = panel.current;
    if (!el) return;
    let x0 = 0, y0 = 0;
    const onStart = (e: TouchEvent) => { x0 = e.touches[0]?.clientX ?? 0; y0 = e.touches[0]?.clientY ?? 0; };
    const onMove = (e: TouchEvent) => {
      const g = gesture.current;
      if (!g || !e.cancelable) return;
      const dx = Math.abs((e.touches[0]?.clientX ?? x0) - x0), dy = (e.touches[0]?.clientY ?? y0) - y0;
      // Only a downward pull at the top is ours; sideways swipes (chip rails) and upward scrolls stay native.
      if (g.active || g.grab || (dy > 0 && dy >= dx && (body.current?.scrollTop ?? 0) <= 0)) e.preventDefault();
    };
    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    return () => { el.removeEventListener('touchstart', onStart); el.removeEventListener('touchmove', onMove); };
  }, []);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !present) return;
    const target = e.target as HTMLElement;
    const grab = !!target.closest('.vx-sheet-grab');
    const inBody = !!body.current?.contains(target);
    // Controls keep their own gestures (range sliders, text selection in inputs).
    if (!grab && target.closest('input, textarea, select, [data-no-drag]')) return;
    if (!grab && inBody && body.current!.scrollTop > 0) return;
    gesture.current = { id: e.pointerId, x: e.clientX, y: e.clientY, grab, active: false };
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g || g.id !== e.pointerId) return;
    const dy = e.clientY - g.y;
    if (!g.active) {
      const dx = Math.abs(e.clientX - g.x);
      if (g.grab ? Math.abs(dy) < 3 : dy < 6 || dx > dy) {
        if (!g.grab && (dy < -6 || dx > 10)) gesture.current = null; // a scroll or a swipe, not a dismiss
        return;
      }
      g.active = true;
      g.y = e.clientY;
      y.stop();
      panel.current?.setPointerCapture?.(e.pointerId);
    }
    y.set(rubber(e.clientY - g.y));
  };
  const onPointerEnd = (e: ReactPointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g || g.id !== e.pointerId) return;
    gesture.current = null;
    if (!g.active) return;
    panel.current?.releasePointerCapture?.(e.pointerId);
    const velocity = y.getVelocity();
    if (e.type !== 'pointercancel' && (y.get() > DISMISS_OFFSET || velocity > DISMISS_VELOCITY)) close.current();
    else animate(y, 0, { ...SPRING.sheet, velocity });
  };
  // Exit keeps the drag's velocity: the spring starts from the motion value's current speed.
  const variants: Variants = reduced
    ? { hidden: { opacity: 0 }, shown: { opacity: 1, transition: { duration: 0.15 } }, gone: { opacity: 0, transition: { duration: 0.15 } } }
    : {
      hidden: { y: '100%' },
      shown: { y: 0, transition: SPRING.sheet },
      gone: () => ({ y: panel.current?.offsetHeight ?? 800, transition: { ...SPRING.sheet, bounce: 0 } }),
    };

  return (
    <>
      <motion.div className={`vx-sheet-scrim${layer === 'top' ? ' top-layer' : ''}`} onClick={() => close.current()} aria-hidden="true"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2, ease: EASE.standard }}>
        <motion.span style={{ opacity: dim }} />
      </motion.div>
      <motion.div ref={panel} className={`vx-sheet${dock ? ' has-dock' : ''}${layer === 'top' ? ' top-layer' : ''}`}
        role="dialog" aria-modal="true" aria-label={label} tabIndex={-1}
        style={{ y }} variants={variants} initial="hidden" animate="shown" exit="gone"
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerEnd} onPointerCancel={onPointerEnd}>
        <div className="vx-sheet-grab" aria-hidden="true"><div className="vx-grabber" /></div>
        <motion.div ref={body} className="vx-sheet-body"
          initial={reduced ? false : { y: 10 }} animate={{ y: 0 }} transition={T_BODY}>
          {children}
        </motion.div>
        {dock && <div className="vx-sheet-dock">{dock}</div>}
      </motion.div>
    </>
  );
}

/** Body content settles a beat after the panel (motion §5.9); position only, so content is never invisible. */
const T_BODY = { delay: 0.08, duration: DUR.medium, ease: EASE.enter };

/** Title block at the top of a sheet. */
export function SheetHead({ title, sub, over }: { title: ReactNode; sub?: ReactNode; over?: ReactNode }) {
  return (
    <div className="vx-sheet-head">
      {over && <span className="vx-over">{over}</span>}
      <h2 className="vx-title-m">{title}</h2>
      {sub && <span className="vx-small vx-2">{sub}</span>}
    </div>
  );
}

/* ---------- feedback states (UI §5.6, interaction §2.7) ---------- */

const VOX_LOOK: CharacterLook = { hue: 'butter', family: 'drift', features: { cheeks: true, lashes: false, brows: false } };
const ASH_LOOK: CharacterLook = { hue: 'ash', family: 'drift', features: { cheeks: false, lashes: false, brows: false } };

/** Empty state: a character (the agent's, or butter Vox), title, one line, optional action. `look={false}` drops the character. */
export function Empty({ title, body, action, look, expr = 'sleeping', size = 120, cloudLabel }: {
  title: string; body?: ReactNode; action?: ReactNode; look?: CharacterLook | false; expr?: Expression; size?: number; cloudLabel?: string;
}) {
  return (
    <div className="vx-empty">
      {look !== false && <Cloud look={look ?? VOX_LOOK} size={size} expr={expr} label={cloudLabel ?? (look ? title : 'Vox')} />}
      <div className="vx-title-m">{title}</div>
      {body && <p>{body}</p>}
      {action}
    </div>
  );
}

/** Load failure: ash cloud asleep, what failed, why, and Try again. Never an endless skeleton. */
export function ErrorState({ title, reason, onRetry, retryLabel, busy }: {
  title: string; reason?: string; onRetry: () => void; retryLabel?: string; busy?: boolean;
}) {
  const copy = useUiCopy();
  return (
    <div role="alert">
      <Empty look={ASH_LOOK} cloudLabel="Vox" expr="sleeping" title={title} body={reason}
        action={(
          <button type="button" className="vx-btn vx-btn-secondary vx-btn-sm" onClick={() => { haptic.tap(); onRetry(); }} disabled={busy}>
            {busy ? <Spinner /> : <Icon name="refresh" size={18} />}{retryLabel ?? copy.retry}
          </button>
        )} />
    </div>
  );
}

const BAR_W = ['62%', '44%', '72%', '54%'];

/** Skeleton list group, row-shaped; fades in only after 150 ms so fast loads never flash. */
export function SkeletonRows({ rows = 3, lead = 'dot', label }: { rows?: number; lead?: 'dot' | 'tile' | false; label?: string }) {
  const copy = useUiCopy();
  return (
    <div className="vx-group vx-skeleton" data-delay="" role="status" aria-label={label ?? copy.loading} aria-busy="true">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className={`vx-row${lead ? ' l' : ''}`} aria-hidden="true">
          {lead && <span className={`vx-skel-dot${lead === 'tile' ? ' tile' : ''}`} />}
          <span className="vx-row-main" style={{ gap: 8 }}>
            <span className="vx-skel-bar title" style={{ width: BAR_W[i % 4] }} />
            <span className="vx-skel-bar" style={{ width: BAR_W[(i + 1) % 4] }} />
          </span>
        </div>
      ))}
    </div>
  );
}

/** Skeleton agent cards with a ghost cloud silhouette, laid out in the same 2-column grid as the real cards. */
export function SkeletonCards({ count = 4, label }: { count?: number; label?: string }) {
  const copy = useUiCopy();
  return (
    <div className="vx-grid" role="status" aria-label={label ?? copy.loading} aria-busy="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="vx-skeleton vx-skel-card" data-delay="" aria-hidden="true">
          <div className="vx-skel-card-face">
            <svg width="104" height="80" viewBox="0 0 104 80"><path fill="currentColor" d="M26 74a22 22 0 0 1-3-43.8A29 29 0 0 1 79 24a24 24 0 0 1-2 50Z" /></svg>
          </div>
          <div className="vx-skel-card-text">
            <span className="vx-skel-bar title" style={{ width: BAR_W[i % 4] }} />
            <span className="vx-skel-bar" style={{ width: BAR_W[(i + 2) % 4] }} />
          </div>
        </div>
      ))}
    </div>
  );
}

/* ---------- selection: segmented, filter chips, space ---------- */

const arrowStep = (e: ReactKeyboardEvent<HTMLElement>) => {
  const rtl = e.currentTarget.closest('[dir]')?.getAttribute('dir') === 'rtl';
  if (e.key === 'ArrowRight') return rtl ? -1 : 1;
  if (e.key === 'ArrowLeft') return rtl ? 1 : -1;
  return 0;
};

/** Segmented control (2–3 modes or tabs). The selection pill slides on SPRING.snappy; arrows move it. */
export function Seg<T extends string>({ options, value, onChange, label, disabled }: {
  options: Array<{ value: T; label: ReactNode }>; value: T; onChange: (v: T) => void; label: string; disabled?: boolean;
}) {
  const pill = useId();
  const reduced = useTier() === 'reduced';
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const pick = (v: T) => { if (v !== value) { haptic.select(); onChange(v); } };
  const onKey = (e: ReactKeyboardEvent<HTMLButtonElement>, i: number) => {
    const step = arrowStep(e);
    if (!step) return;
    e.preventDefault();
    const n = (i + step + options.length) % options.length;
    refs.current[n]?.focus();
    pick(options[n].value);
  };
  return (
    <div className="vx-seg live" role="tablist" aria-label={label}>
      {options.map((o, i) => {
        const on = o.value === value;
        return (
          <button key={o.value} ref={(el) => { refs.current[i] = el; }} type="button" role="tab" aria-selected={on} tabIndex={on ? 0 : -1}
            disabled={disabled} onClick={() => pick(o.value)} onKeyDown={(e) => onKey(e, i)}>
            {on && <motion.span layoutId={`seg-${pill}`} className="vx-seg-pill" transition={reduced ? { duration: 0 } : SPRING.snappy} />}
            <span className="vx-seg-label">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Single-choice filter chips with a sliding highlight and optional counts (Home filters). */
export function FilterChips<T extends string>({ options, value, onChange, label }: {
  options: Array<{ value: T; label: string; count?: number }>; value: T; onChange: (v: T) => void; label: string;
}) {
  const pill = useId();
  const reduced = useTier() === 'reduced';
  return (
    <div className="vx-chips live" role="group" aria-label={label}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button key={o.value} type="button" className="vx-chip" aria-pressed={on} aria-label={o.count != null ? `${o.label} ${o.count}` : undefined}
            onClick={() => { if (!on) { haptic.select(); onChange(o.value); } }}>
            {on && <motion.span layoutId={`chips-${pill}`} className="vx-chip-pill" transition={reduced ? { duration: 0 } : SPRING.snappy} />}
            <span className="vx-chip-label">{o.label}{o.count != null && <span className="vx-chip-count">{o.count}</span>}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Work / Personal, app-level (nav.space); value/onChange override it for isolated use. */
export function SpaceSwitch({ value, onChange }: { value?: 'work' | 'personal'; onChange?: (s: 'work' | 'personal') => void }) {
  const nav = useNav();
  const c = privacyCopy[nav.locale ?? 'en'];
  return (
    <Seg label={c.space} value={value ?? nav.space} onChange={onChange ?? nav.setSpace}
      options={[{ value: 'work', label: c.work }, { value: 'personal', label: c.personal }]} />
  );
}

/* ---------- lists ---------- */

export function Section({ title, label, id, end, foot, children, plain }: {
  label?: ReactNode; id?: string; title?: ReactNode; end?: ReactNode; foot?: ReactNode; children: ReactNode;
  /** Children are not rows: skip the grouped-list frame */
  plain?: boolean;
}) {
  const generated = useId();
  const head = id ?? generated;
  title ??= label;
  return (
    <section className="vx-section" aria-labelledby={title ? head : undefined}>
      {(title || end) && <div className="vx-section-head">{title && <h2 id={head} className="vx-over">{title}</h2>}{end}</div>}
      {plain ? children : <div className="vx-group">{children}</div>}
      {foot && <p className="vx-section-foot">{foot}</p>}
    </section>
  );
}

export interface RowProps {
  as?: 'button' | 'div' | 'label';
  lead?: ReactNode;
  title: ReactNode;
  sub?: ReactNode;
  subTone?: 'warn';
  value?: ReactNode;
  end?: ReactNode;
  chevron?: boolean;
  tone?: 'danger';
  size?: 'l';
  align?: 'top';
  /** Nav/settings rows use a 400 title; entity rows keep 600 */
  plain?: boolean;
  onClick?: () => void;
  disabled?: boolean;
  role?: string;
  'aria-checked'?: boolean;
  'aria-pressed'?: boolean;
  'aria-label'?: string;
  'aria-current'?: 'page' | 'true' | boolean;
}

export function Row({ as, lead, title, sub, subTone, value, end, chevron, tone, size, align, plain, onClick, disabled, ...aria }: RowProps) {
  const Tag = as ?? (onClick ? 'button' : 'div');
  const cls = ['vx-row', Tag === 'button' && 'vx-row-btn', size, align, tone].filter(Boolean).join(' ');
  return (
    <Tag className={cls} onClick={onClick} {...(Tag === 'button' ? { type: 'button' as const, disabled } : {})} {...aria}>
      {lead}
      <span className="vx-row-main">
        <span className={`vx-row-title${plain ? ' plain' : ''}`}>{title}</span>
        {sub && <span className={`vx-row-sub${subTone ? ` ${subTone}` : ''}`}>{sub}</span>}
      </span>
      {value !== undefined && value !== null && <span className="vx-row-value">{value}</span>}
      {end}
      {chevron && <span className="vx-chev" aria-hidden="true"><Icon name="forward" size={18} flip={false} /></span>}
    </Tag>
  );
}

const KNOB: Variants = {
  on: { scaleX: [1, 1.3, 1], transition: { duration: 0.2, ease: EASE.standard } },
  off: { scaleX: [1, 1.3, 1], transition: { duration: 0.2, ease: EASE.standard } },
};

function Knob({ checked }: { checked: boolean }) {
  const reduced = useTier() === 'reduced';
  return (
    <motion.span className="vx-switch-knob" layout transition={reduced ? { duration: 0 } : SPRING.snappy}>
      <motion.span initial={false} animate={checked ? 'on' : 'off'} variants={reduced ? undefined : KNOB} />
    </motion.span>
  );
}

/** A full settings row with a switch (role=switch). The knob springs across and stretches mid-travel.
 *  `attention` marks a choice that is on but not in effect (it needs review): the track turns warn and the sub reads warn. */
export function Switch({ checked, onChange, label, sub, disabled, lead, attention }: {
  checked: boolean; onChange: (v: boolean) => void; label: ReactNode; sub?: ReactNode; disabled?: boolean; lead?: ReactNode; attention?: boolean;
}) {
  return (
    <button type="button" role="switch" aria-checked={checked} disabled={disabled} className="vx-row vx-row-btn"
      onClick={() => { haptic.select(); onChange(!checked); }}>
      {lead}
      <span className="vx-row-main">
        <span className="vx-row-title plain">{label}</span>
        {sub && <span className={attention ? 'vx-row-sub warn' : 'vx-row-sub'}>{sub}</span>}
      </span>
      <span className={attention ? 'vx-switch live attention' : 'vx-switch live'} aria-hidden="true"><Knob checked={checked} /></span>
    </button>
  );
}

/** The bare switch, for rows that need their own layout (an avatar and name, say). */
export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} className="vx-switch live vx-toggle"
      onClick={() => { haptic.select(); onChange(!checked); }}>
      <Knob checked={checked} />
    </button>
  );
}

/** Decorative marks for a Row with role=radio / role=checkbox (state comes from the row's aria-checked). */
export const Radio = () => <span className="vx-radio" aria-hidden="true" />;
export const Check = () => <span className="vx-check" aria-hidden="true"><Icon name="check" size={14} width={3} /></span>;

/** Selectable option card (voice previews, species). Selection is shown by tint, border and the action's label. */
export function Option({ selected, lead, title, sub, action, children, onClick, label }: {
  selected: boolean; lead?: ReactNode; title: ReactNode; sub?: ReactNode; action?: ReactNode; children?: ReactNode;
  /** Makes the whole card a press target (no nested buttons then) */
  onClick?: () => void; label?: string;
}) {
  const inner = (
    <>
      {lead}
      <span className="vx-row-main">
        <span className="vx-row-title">{title}</span>
        {sub && <span className="vx-row-sub">{sub}</span>}
      </span>
      {children}
      {action}
    </>
  );
  if (onClick) {
    return (
      <button type="button" className={`vx-option tap${selected ? ' selected' : ''}`} role="radio" aria-checked={selected} aria-label={label}
        onClick={() => { haptic.select(); onClick(); }}>
        {inner}
      </button>
    );
  }
  return <div className={`vx-option${selected ? ' selected' : ''}`} aria-current={selected || undefined}>{inner}</div>;
}

/** Choose → Chosen pill for option cards: s3 until chosen, then the agent hue. Never volt. */
export function Choose({ chosen, onClick, busy, disabled, label }: { chosen: boolean; onClick: () => void; busy?: boolean; disabled?: boolean; label: string }) {
  const copy = useUiCopy();
  return (
    <button type="button" className={`vx-btn vx-btn-xs vx-choose${chosen ? ' vx-btn-hue' : ''}`} aria-pressed={chosen} aria-label={label}
      aria-busy={busy || undefined} disabled={disabled || busy} onClick={onClick}>
      {busy ? <Spinner size={14} /> : chosen ? <><Icon name="check" size={14} width={2.5} />{copy.chosen}</> : copy.choose}
    </button>
  );
}

export const Meta = ({ children, icon }: { children: ReactNode; icon?: string }) => (
  <span className="vx-meta">{icon && <Icon name={icon} size={14} />}{children}</span>
);
export const Metas = ({ children }: { children: ReactNode }) => <div className="vx-metas">{children}</div>;

/* ---------- conversation ---------- */

export function Composer({ value, onChange, onSend, placeholder, busy, tool, label = 'Message', sendLabel = 'Send', multiline, autoFocus, maxLength, disabled }: {
  value: string; onChange: (v: string) => void; onSend: () => void; placeholder?: string; busy?: boolean; tool?: ReactNode;
  label?: string; sendLabel?: string;
  /** Textarea that grows from 1 to 5 lines; Enter sends, Shift+Enter breaks the line */
  multiline?: boolean; autoFocus?: boolean; maxLength?: number; disabled?: boolean;
}) {
  const area = useRef<HTMLTextAreaElement>(null);
  const ready = !!value.trim() && !busy && !disabled;
  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  const send = () => { if (ready) { haptic.tap(); onSend(); } };
  return (
    <form className={`vx-composer${tool ? ' has-tool' : ''}`} onSubmit={(e) => { e.preventDefault(); send(); }}>
      {tool}
      {multiline ? (
        <textarea ref={area} rows={1} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={label} dir="auto"
          autoFocus={autoFocus} maxLength={maxLength} disabled={disabled}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }} />
      ) : (
        <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={label} dir="auto"
          autoFocus={autoFocus} maxLength={maxLength} disabled={disabled} enterKeyHint="send" />
      )}
      <button type="submit" className="vx-composer-send" aria-label={sendLabel} disabled={!ready}>
        {busy ? <Spinner /> : <Icon name="send" size={18} width={2} />}
      </button>
    </form>
  );
}

export const Bubble = ({ from, children, failed }: { from: 'me' | 'agent'; children: ReactNode; failed?: boolean }) => (
  <div className={`vx-bubble ${from}${failed ? ' failed' : ''}`} dir="auto">{children}</div>
);

/** Typing indicator: three dots in an agent bubble. */
export const Typing = ({ label = 'Typing' }: { label?: string }) => (
  <div className="vx-bubble agent" role="status" aria-label={label}><span className="vx-typing" aria-hidden="true"><span /><span /><span /></span></div>
);

/* ---------- banners, stats ---------- */

const BANNER_ICON = { info: 'info', warn: 'warn', danger: 'warn', success: 'check' } as const;

export function Banner({ tone, icon, action, children }: { tone: 'info' | 'warn' | 'danger' | 'success'; icon?: string | false; action?: ReactNode; children: ReactNode }) {
  return (
    <div className={`vx-banner ${tone}`} role={tone === 'danger' ? 'alert' : undefined}>
      {icon !== false && <Icon name={icon ?? BANNER_ICON[tone]} size={18} />}
      <div className="vx-banner-body"><span>{children}</span>{action}</div>
    </div>
  );
}

export const Stat = ({ value, label }: { value: ReactNode; label: ReactNode }) => (
  <div className="vx-stat"><dt className="vx-stat-label">{label}</dt><dd className="vx-stat-value vx-num">{value}</dd></div>
);
/** `compact` packs the tiles tighter (settings pages, diagnostics). */
export const Stats = ({ children, compact }: { children: ReactNode; compact?: boolean }) => <dl className={`vx-stats${compact ? ' vx-stats-compact' : ''}`}>{children}</dl>;

/* ---------- picker ---------- */

/** A sheet of radio rows with optional search; for more than 3 options (UI §5.5). */
export function Picker<T extends string>({ open, onClose, title, options, value, onChange, search, searchLabel: searchProp, empty: emptyProp }: {
  open: boolean; onClose: () => void; title: string; options: Array<{ value: T; label: string; sub?: string; lead?: ReactNode }>; value: T | null;
  onChange: (v: T) => void; search?: boolean; searchLabel?: string; empty?: string;
}) {
  const copy = useUiCopy();
  const searchLabel = searchProp ?? copy.search;
  const empty = emptyProp ?? copy.nothingMatches;
  const [q, setQ] = useState('');
  useEffect(() => { if (!open) setQ(''); }, [open]);
  const needle = q.trim().toLowerCase();
  const shown = needle ? options.filter((o) => `${o.label} ${o.sub ?? ''}`.toLowerCase().includes(needle)) : options;
  return (
    <Sheet open={open} onClose={onClose} label={title}>
      <SheetHead title={title} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {search && (
          <label className="vx-search">
            <Icon name="search" size={18} />
            <input className="vx-input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={searchLabel} aria-label={`${searchLabel} ${title}`} dir="auto" />
          </label>
        )}
        {shown.length === 0 ? <p className="vx-small vx-2" role="status" style={{ margin: 0, textAlign: 'center', padding: 16 }}>{empty}</p> : (
          <div className="vx-group" role="radiogroup" aria-label={title}>
            {shown.map((o) => (
              <Row key={o.value} role="radio" aria-checked={o.value === value} title={o.label} sub={o.sub} plain
                lead={o.lead} end={<Radio />}
                onClick={() => { haptic.select(); onChange(o.value); onClose(); }} />
            ))}
          </div>
        )}
      </div>
    </Sheet>
  );
}

/* ---------- confirm (interaction §2.4) ---------- */

export interface ConfirmOptions {
  title: string;
  body?: ReactNode;
  confirmLabel: string;
  /** default 'Keep' for danger, 'Cancel' otherwise */
  cancelLabel?: string;
  tone?: 'danger' | 'default';
  look?: CharacterLook;
  expr?: Expression;
}

export function ConfirmSheet({ open, options, onAnswer }: { open: boolean; options: ConfirmOptions | null; onAnswer: (ok: boolean) => void }) {
  const keep = useRef<HTMLButtonElement>(null);
  const danger = options?.tone === 'danger';
  const copy = useUiCopy();
  return (
    <Sheet open={open} onClose={() => onAnswer(false)} label={options?.title ?? copy.confirm} initialFocus={keep} layer="top">
      {options && (
        <div className="vx-confirm">
          {options.look && <Cloud look={options.look} size={96} expr={options.expr ?? (danger ? 'sleeping' : 'idle')} label={options.title} />}
          <h2 className="vx-title-m">{options.title}</h2>
          {options.body && <p>{options.body}</p>}
          <div className="vx-confirm-actions">
            <button type="button" className={`vx-btn vx-btn-block ${danger ? 'vx-btn-danger solid' : 'vx-btn-primary'}`}
              onClick={() => { if (danger) haptic.medium(); else haptic.tap(); onAnswer(true); }}>{options.confirmLabel}</button>
            <button type="button" ref={keep} className="vx-btn vx-btn-secondary vx-btn-block" onClick={() => onAnswer(false)}>
              {options.cancelLabel ?? (danger ? copy.keep : copy.cancel)}
            </button>
          </div>
        </div>
      )}
    </Sheet>
  );
}

type Confirm = (o: ConfirmOptions) => Promise<boolean>;
const ConfirmContext = createContext<Confirm | null>(null);

/** Hosts one ConfirmSheet for the app; useConfirm() opens it. */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const [open, setOpen] = useState(false);
  const resolver = useRef<((ok: boolean) => void) | null>(null);
  const confirm = useCallback<Confirm>((o) => new Promise<boolean>((resolve) => {
    resolver.current?.(false);
    resolver.current = resolve;
    if (o.tone === 'danger') haptic.warn();
    setOptions(o); setOpen(true);
  }), []);
  const answer = (ok: boolean) => { resolver.current?.(ok); resolver.current = null; setOpen(false); };
  useEffect(() => () => { resolver.current?.(false); }, []);
  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <ConfirmSheet open={open} options={options} onAnswer={answer} />
    </ConfirmContext.Provider>
  );
}

/** Ask before a destructive step: resolves true on confirm, false on Keep, scrim, drag or Escape. */
export function useConfirm(): Confirm {
  const ctx = useContext(ConfirmContext);
  // Outside a ConfirmProvider (isolated tests) the native dialog stands in.
  return useMemo(() => ctx ?? ((o: ConfirmOptions) => Promise.resolve(typeof window !== 'undefined' && window.confirm(o.title))), [ctx]);
}

/* ---------- hue ---------- */

const rgba = (hex: string, a: number) => {
  const n = parseInt(hex.slice(1, 7), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};

/** Agent hue as CSS variables, set once on a screen or card root (no color-mix: old Android WebViews). */
export function hueVars(pal: Pick<HuePalette, 'base' | 'light' | 'shadow' | 'glow'>): CSSProperties {
  return {
    '--hue': pal.base, '--hue-light': pal.light, '--hue-shadow': pal.shadow, '--hue-glow': pal.glow,
    '--hue-10': rgba(pal.base, 0.1), '--hue-12': rgba(pal.base, 0.12), '--hue-22': rgba(pal.glow, 0.22),
  } as CSSProperties;
}

/** A grouped-list entry that opens another screen. */
export function NavRow({ label, detail, onClick, disabled }: { label: string; detail?: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button className="vx-row vx-nav-row" onClick={onClick} disabled={disabled}>
      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span>{label}</span>
        {detail && <span className="vx-small vx-2">{detail}</span>}
      </span>
      <span className="vx-chev"><Icon name="chevronEnd" size={18} flip={false} /></span>
    </button>
  );
}
