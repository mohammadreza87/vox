'use client';

import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { haptic, type AgentView, type SpawnBrief } from '../../../_lib/client';
import type { Hue } from '@/lib/studio/types';
import { Cloud } from '../../Cloud';
import { Spinner } from '../../ui';
import { familyFor } from './catalog';
import { textAttrs } from './routing';

export type Busy = null | string;
export type Run = <T>(label: string, fn: () => Promise<T>) => Promise<T | undefined>;
export interface StepProps { agent: AgentView; busy: Busy; run: Run; onUpdate: (a: AgentView) => void; onNext: () => void }
export type Presentation = NonNullable<SpawnBrief['presentation']>;

export function Dock({ children, className, style, inert }: { children: ReactNode; className?: string; style?: CSSProperties; inert?: boolean }) {
  return <div className={className ? `vx-dock ${className}` : 'vx-dock'} style={style} inert={inert || undefined}>{children}</div>;
}

/** `group` for chip sets: a <label> around buttons would name (and click) the first chip. */
export function Field({ label, children, hint, group }: { label: ReactNode; children: ReactNode; hint?: string; group?: boolean }) {
  const Tag = group ? 'div' : 'label';
  return (
    <Tag role={group ? 'group' : undefined} aria-label={group && typeof label === 'string' ? label : undefined} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <span className="vx-over">{label}</span>
      {children}
      {hint && <span className="vx-small vx-2">{hint}</span>}
    </Tag>
  );
}

export function Chips<T extends string>({ options, value, onChange, multi }: {
  options: Array<{ value: T; label: string }>; value: T[]; onChange: (v: T[]) => void; multi?: boolean;
}) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      {options.map((o) => {
        const on = value.includes(o.value);
        return (
          <button key={o.value} type="button" className="vx-chip vx-hit" aria-pressed={on} onClick={() => {
            haptic.select();
            if (multi) onChange(on ? value.filter((v) => v !== o.value) : [...value, o.value]);
            else onChange(on ? [] : [o.value]);
          }}>{o.label}</button>
        );
      })}
    </div>
  );
}

export function Slider({ left, right, value, onChange }: { left: string; right: string; value: number; onChange: (v: number) => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <input className="vx-range" type="range" min={0} max={100} value={value} onChange={(e) => onChange(Number(e.target.value))} aria-label={`${left} to ${right}`} />
      <div style={{ display: 'flex', justifyContent: 'space-between' }} className="vx-small vx-2"><span>{left}</span><span>{right}</span></div>
    </div>
  );
}

export function EditableRow({ label, value, rows, editing, draft, readOnly, onEdit, onDraft, onCancel, onSave, saving, changed, tone }: {
  label: string; value: string; rows: number; editing: boolean; draft: string; readOnly?: boolean;
  onEdit: () => void; onDraft: (v: string) => void; onCancel: () => void; onSave: () => void; saving: boolean;
  changed?: boolean; tone?: 'warn';
}) {
  const over = tone === 'warn' ? 'vx-over vx-over-warn' : 'vx-over';
  if (editing) {
    return (
      <div className="vx-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
        <span className={over}>{label}</span>
        {rows > 1
          ? <textarea className="vx-textarea" {...textAttrs(draft)} rows={rows + 1} value={draft} onChange={(e) => onDraft(e.target.value)} autoFocus maxLength={800} />
          : <input className="vx-input" {...textAttrs(draft)} value={draft} onChange={(e) => onDraft(e.target.value)} autoFocus maxLength={120} />}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="vx-btn vx-btn-secondary vx-btn-sm" onClick={onCancel}>Cancel</button>
          <button className="vx-btn vx-btn-primary vx-btn-sm" onClick={onSave} disabled={saving || !draft.trim()}>{saving ? <Spinner /> : 'Save'}</button>
        </div>
      </div>
    );
  }
  return (
    <button className="vx-row vx-edit-row" onClick={readOnly ? undefined : onEdit} disabled={readOnly}>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span className={over}>{label}</span>
        <span {...textAttrs(value)} style={{ fontSize: 15, lineHeight: '21px', overflowWrap: 'anywhere' }}>
          {value ? <span className={changed ? 'vx-changed' : undefined}>{value}</span> : <span className="vx-3">—</span>}
        </span>
      </div>
      {!readOnly && <span className="vx-small vx-3" style={{ paddingTop: 2 }}>Edit</span>}
    </button>
  );
}

export function ListRow({ label, items, changed }: { label: string; items: string[]; changed?: boolean }) {
  if (!items.length) return null;
  return (
    <div className="vx-row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 8 }}>
      <span className={changed ? 'vx-over vx-changed' : 'vx-over'}>{label}</span>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {items.map((i) => <span key={i} {...textAttrs(i)} className="vx-chip" style={{ cursor: 'default', height: 28, display: 'inline-flex', alignItems: 'center' }}>{i}</span>)}
      </div>
    </div>
  );
}

/** A static cloud in a role's hue: no animation, hidden from assistive tech. */
export function MiniCloud({ hue, id, size }: { hue: Hue; id: string; size: number }) {
  return (
    <span className="vx-still" aria-hidden="true" style={{ flexShrink: 0, width: size, height: size, display: 'block' }}>
      <Cloud look={{ hue, family: familyFor(id), features: { cheeks: true, lashes: false, brows: false } }} size={size} expr="idle" label="" />
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
