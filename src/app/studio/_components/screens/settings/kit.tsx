'use client';

import { motion, useReducedMotion } from 'framer-motion';
import { createContext, useContext, useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { tg } from '../../../_lib/client';
import { haptic } from '../../../_lib/haptics';
import { listItem, T } from '../../../_lib/motion';
import { useNav } from '../../StudioApp';
import { Icon, Seg, Sheet, TopBar, type SheetProps } from '../../ui';

/** First-load list entrance (motion §5.4): staggered rise once, a plain cross-fade on later mounts, nothing when reduced. */
export function Enter({ i = 0, first, children, className }: { i?: number; first: boolean; children: ReactNode; className?: string }) {
  const reduced = useReducedMotion();
  return (
    <motion.div className={className} initial={reduced ? false : first ? listItem.initial : { opacity: 0 }} animate={listItem.animate}
      transition={first ? T.listItem(i) : T.fadeIn}>
      {children}
    </motion.div>
  );
}

/** True until the first render where `ready` holds has committed, so refetches and remounts don't replay the entrance. */
export function useFirstLoad(ready: boolean) {
  const first = useRef(true);
  const value = first.current;
  useLayoutEffect(() => { if (ready) first.current = false; }, [ready]);
  return value;
}

const Live = createContext<ReactNode>(null);
function LiveSlot() { return <>{useContext(Live)}</>; }

/**
 * A Sheet whose content stays live while it animates out. A plain Sheet keeps rendering its last children during the exit
 * spring; for private content that must vanish the moment its scope changes (space, account, agent), pass `scope`:
 * the closing sheet keeps its content only while the scope is unchanged.
 */
export function LiveSheet({ open, scope, children, ...props }: SheetProps & { scope: string }) {
  const last = useRef<{ scope: string; node: ReactNode } | null>(null);
  // Remembers what was on screen when the sheet started closing.
  if (open) last.current = { scope, node: children };
  const live = open ? children : last.current?.scope === scope ? last.current.node : null;
  return <Live.Provider value={live}><Sheet open={open} {...props}><LiveSlot /></Sheet></Live.Provider>;
}

/* ---------- settings sub-page building blocks (UI §5.2) ---------- */

/** Compact leading icon tile for settings rows. */
export const IconTile = ({ name, tone }: { name: string; tone?: 'ok' | 'warn' | 'volt' }) => (
  <span className={`vx-tile icon${tone ? ` ${tone}` : ''}`} aria-hidden="true"><Icon name={name} size={20} /></span>
);

/** Leading letter tile for an entity without a character (a service, a person). */
export const LetterTile = ({ text, round }: { text: string; round?: boolean }) => (
  <span className={round ? 'vx-initials' : 'vx-tile'} aria-hidden="true">{[...text.trim()][0]?.toUpperCase() ?? '·'}</span>
);

/** Up to four initials, overlapped (the audience of a shared note). */
export function Faces({ names, max = 4 }: { names: string[]; max?: number }) {
  const shown = names.slice(0, max), rest = names.length - shown.length;
  return (
    <span className="vx-avatars vx-faces" aria-hidden="true">
      {shown.map((n, i) => <span key={`${n}:${i}`} className="vx-initials">{[...n.trim()][0]?.toUpperCase() ?? '·'}</span>)}
      {rest > 0 && <span className="vx-initials more">+{rest}</span>}
    </span>
  );
}

/** A pushed settings page: pinned top bar (back to You, centred title), one scroller, optional dock CTA. */
export function SettingsPage({ title, back, busy, dock, children, className }: {
  title: ReactNode; back?: string; busy?: boolean; dock?: ReactNode; children: ReactNode; className?: string;
}) {
  const nav = useNav();
  return <>
    <TopBar lead="back" onLead={nav.back} leadLabel={back ?? (nav.locale === 'fa' ? 'شما' : 'You')} title={title} />
    <section className={`vx-scroll vx-settings-page${className ? ` ${className}` : ''}`} dir={nav.dir} lang={nav.locale} aria-busy={busy || undefined}>
      {children}
    </section>
    {dock && <div className="vx-dock stack" dir={nav.dir}>{dock}</div>}
  </>;
}

/** The app-level Work / Personal switch, sticky under the top bar on space-scoped pages (it writes nav.space). */
export function SpaceBar({ disabled, label }: { disabled?: boolean; label?: string }) {
  const nav = useNav();
  const fa = nav.locale === 'fa';
  return (
    <div className="vx-space-bar">
      <Seg label={label ?? (fa ? 'فضا' : 'Space')} value={nav.space} disabled={disabled} onChange={nav.setSpace}
        options={[{ value: 'work', label: fa ? 'کاری' : 'Work' }, { value: 'personal', label: fa ? 'شخصی' : 'Personal' }]} />
    </div>
  );
}

/** − n + for small bounded counts; the value is announced politely. */
export function Stepper({ value, min, max, onChange, label, disabled, format = String }: {
  value: number; min: number; max: number; onChange: (v: number) => void; label: string; disabled?: boolean; format?: (n: number) => string;
}) {
  const step = (d: number) => { const next = Math.min(max, Math.max(min, value + d)); if (next !== value) { haptic.select(); onChange(next); } };
  return (
    <span className="vx-stepper" role="group" aria-label={label}>
      <button type="button" className="vx-stepper-btn" aria-label={`${label} −`} disabled={disabled || value <= min} onClick={() => step(-1)}><Icon name="minus" size={18} width={2} /></button>
      <output className="vx-stepper-value vx-num" aria-live="polite">{format(value)}</output>
      <button type="button" className="vx-stepper-btn" aria-label={`${label} +`} disabled={disabled || value >= max} onClick={() => step(1)}><Icon name="plus" size={18} width={2} /></button>
    </span>
  );
}

/** A read-only fact row: label on the start, value on the end (approval summaries, workflow details). */
export function Fact({ label, children, sub }: { label: ReactNode; children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="vx-row vx-fact">
      <span className="vx-row-main"><span className="vx-row-sub">{label}</span>{sub}</span>
      <span className="vx-fact-value">{children}</span>
    </div>
  );
}

/**
 * Runs `cb` when the person comes back to the Mini App (Telegram `activated`, or the tab becoming visible in a
 * browser): the OAuth round trip returns here, so a pending sign-in can be checked without a tap.
 */
export function useOnReturn(cb: () => void, active: boolean) {
  const ref = useRef(cb);
  ref.current = cb;
  useEffect(() => {
    if (!active) return;
    const run = () => ref.current();
    const onVisible = () => { if (document.visibilityState === 'visible') run(); };
    const app = tg() as (ReturnType<typeof tg> & TelegramEvents) | null;
    app?.onEvent?.('activated', run);
    document.addEventListener('visibilitychange', onVisible);
    return () => { app?.offEvent?.('activated', run); document.removeEventListener('visibilitychange', onVisible); };
  }, [active]);
}

type TelegramEvents = { onEvent?(e: 'activated', cb: () => void): void; offEvent?(e: 'activated', cb: () => void): void };

/** Locale-aware date and time, never throwing on a bad zone. */
export function formatWhen(at: number, fa: boolean, opts: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' }, timeZone?: string) {
  try { return new Intl.DateTimeFormat(fa ? 'fa-IR' : 'en-GB', { ...opts, ...(timeZone ? { timeZone } : {}) }).format(at); }
  catch { return new Date(at).toISOString(); }
}

/** Two-digit hour label (22:00). */
export const hourLabel = (h: number, fa: boolean) => `${String(h).padStart(2, '0')}:00`.replace(/\d/g, d => fa ? '۰۱۲۳۴۵۶۷۸۹'[Number(d)] : d);

/** IANA zones the runtime knows, falling back to a short list on old WebViews. */
export function timeZones(current?: string): string[] {
  let zones: string[] = [];
  try { zones = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? []; } catch { /* old runtime */ }
  if (!zones.length) zones = ['UTC', 'Europe/London', 'Europe/Berlin', 'Europe/Tallinn', 'Europe/Istanbul', 'Asia/Tehran', 'Asia/Dubai', 'Asia/Kolkata', 'Asia/Tokyo', 'America/New_York', 'America/Chicago', 'America/Los_Angeles', 'Australia/Sydney'];
  const device = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return ''; } })();
  return [...new Set([current, device, ...zones].filter((z): z is string => !!z))];
}

/** A refusal repeated inside a sheet. The page's own banner already announces it (role=alert), so this copy stays silent. */
export const SheetError = ({ children }: { children: ReactNode }) => (
  <div className="vx-banner danger vx-sheet-error"><Icon name="warn" size={18} /><div className="vx-banner-body"><span>{children}</span></div></div>
);
