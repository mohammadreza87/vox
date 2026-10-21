'use client';

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { Hue } from '@/lib/studio/types';
import { haptic, type AgentView, type PersonaSpec, type SpawnBrief } from '../../../_lib/client';
import { Cloud } from '../../Cloud';
import { familyFor } from './catalog';

export type Busy = null | string;
export type Run = <T>(label: string, fn: () => Promise<T>) => Promise<T | undefined>;
export interface StepProps { agent: AgentView; busy: Busy; run: Run; onUpdate: (a: AgentView) => void; onNext: () => void }
export type Presentation = NonNullable<SpawnBrief['presentation']>;

/**
 * Bottom CTA area. `stack` puts a composer or helper line above the CTA row; `inert` while a
 * sheet is open over the step; `style` lifts it above the on-screen keyboard.
 */
export function Dock({ children, stack, className, style, inert }: {
  children: ReactNode; stack?: boolean; className?: string; style?: CSSProperties; inert?: boolean;
}) {
  const cls = ['vx-dock', stack && 'stack', className].filter(Boolean).join(' ');
  return <div className={cls} style={style} inert={inert || undefined}>{children}</div>;
}

/** `group` for chip sets: a <label> around buttons would name (and click) the first chip. */
export function Field({ label, children, hint, group }: { label: ReactNode; children: ReactNode; hint?: string; group?: boolean }) {
  const Tag = group ? 'div' : 'label';
  return (
    <Tag className="vx-field" role={group ? 'group' : undefined} aria-label={group && typeof label === 'string' ? label : undefined}>
      <span className="vx-over">{label}</span>
      {children}
      {hint && <span className="vx-small vx-3">{hint}</span>}
    </Tag>
  );
}

export function Chips<T extends string>({ options, value, onChange, multi, disabled }: {
  options: Array<{ value: T; label: string }>; value: T[]; onChange: (v: T[]) => void; multi?: boolean; disabled?: boolean;
}) {
  return (
    <div className="vx-chip-wrap">
      {options.map((o) => {
        const on = value.includes(o.value);
        return (
          <button key={o.value} type="button" className="vx-chip" aria-pressed={on} disabled={disabled} onClick={() => {
            haptic.select();
            if (multi) onChange(on ? value.filter((v) => v !== o.value) : [...value, o.value]);
            else onChange(on ? [] : [o.value]);
          }}>{o.label}</button>
        );
      })}
    </div>
  );
}

/** Trait slider with end labels; a selection haptic every 10 units (interaction §3.4.1). */
export function Slider({ left, right, value, onChange, label = `${left} to ${right}` }: { left: string; right: string; value: number; onChange: (v: number) => void; label?: string }) {
  return (
    <div className="vx-slider">
      <input className="vx-range" type="range" min={0} max={100} value={value} aria-label={label}
        onChange={(e) => { const v = Number(e.target.value); if (Math.floor(v / 10) !== Math.floor(value / 10)) haptic.select(); onChange(v); }} />
      <div className="vx-slider-ends vx-small vx-2"><span>{left}</span><span>{right}</span></div>
    </div>
  );
}

/** One audio element for a screen: playing another key stops the first; tapping the same key stops it. */
export function usePlayer() {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  useEffect(() => () => { audio.current?.pause(); }, []);
  const play = (key: string, src: string) => {
    audio.current?.pause();
    if (playing === key) { setPlaying(null); return; }
    const a = new Audio(src);
    audio.current = a;
    a.onended = () => setPlaying(null);
    a.play().then(() => setPlaying(key)).catch(() => setPlaying(null));
  };
  return { playing, play };
}

/** Waveform bars: animate only while playing, settle to a quiet uneven line otherwise (board spawn-3; delays in CSS). */
export function Bars({ active, count = 7 }: { active: boolean; count?: number }) {
  return (
    <svg className="vx-bars" width={count * 6 - 2} height="20" viewBox={`0 0 ${count * 6 - 2} 20`} aria-hidden="true" data-on={active || undefined}>
      {Array.from({ length: count }, (_, i) => <rect key={i} x={i * 6} y={2} width={3} height={16} rx={1.5} className={active ? 'vx-bar' : undefined} />)}
    </svg>
  );
}

const LANGUAGE_CODES: Record<string, string> = {
  english: 'en', en: 'en', persian: 'fa', farsi: 'fa', 'فارسی': 'fa', fa: 'fa', vietnamese: 'vi', 'tiếng việt': 'vi', vi: 'vi',
  arabic: 'ar', turkish: 'tr', french: 'fr', german: 'de', spanish: 'es',
};

/** A persona language ("Persian", "fa-IR") as an ISO code, or '' when unknown. */
export function languageCode(language: string | undefined): string {
  const l = language?.trim().toLowerCase() ?? '';
  return LANGUAGE_CODES[l] ?? (/^[a-z]{2,3}(?:[-_]|$)/.test(l) ? l.split(/[-_]/)[0] : '');
}

/** What the agent says when you tap play on its voice, in the chosen (or first) language. */
export function sampleLine(p: Pick<PersonaSpec, 'name' | 'tagline' | 'languages'>, language = languageCode(p.languages[0])): string {
  if (language === 'fa') return `سلام، من ${p.name} هستم. خوشحالم که با هم صحبت می‌کنیم.`;
  if (language === 'vi') return `Xin chào, tôi là ${p.name}. Rất vui được trò chuyện với bạn.`;
  return `Hi, I'm ${p.name}. ${p.tagline}`.trim();
}

/** A still cloud in a role's hue (role cards and the role sheet): no animation, hidden from assistive tech. */
export function MiniCloud({ hue, id, size }: { hue: Hue; id: string; size: number }) {
  return (
    <span className="vx-still" aria-hidden="true" style={{ flexShrink: 0, width: size, height: size, display: 'block' }}>
      <Cloud look={{ hue, family: familyFor(id), features: { cheeks: true, lashes: false, brows: false } }} size={size} still expr="idle" label="" />
    </span>
  );
}

/**
 * The scrolling part of a sheet. The shared Sheet is draggable on y, which
 * (via touch-action: pan-x) blocks native vertical scrolling inside it; this
 * is its own scroller and keeps pointerdowns from starting the sheet drag.
 */
export function SheetScroll({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const stop = (e: PointerEvent) => e.stopPropagation();
    el.addEventListener('pointerdown', stop);
    return () => el.removeEventListener('pointerdown', stop);
  }, []);
  return <div ref={ref} className="vx-sheet-scroll">{children}</div>;
}
