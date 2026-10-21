'use client';

import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import type { CharacterLook } from '@/lib/studio/types';
import { haptic } from '../../_lib/haptics';
import { Cloud } from '../Cloud';
import { Icon } from '../ui';

export interface RailOption<T extends string> {
  value: T;
  label: string;
  /** The current look with this option applied: what the card shows */
  look: CharacterLook;
  /** Why it can't be picked with the rest of the look (isCompatible), or null */
  blocked?: string | null;
  /** ✦ suggested for the agent's role */
  suggested?: boolean;
}

const TIP_MS = 2800;

/** Arrow direction in reading order (Left/Right swap in RTL). */
export function arrowStep(e: KeyboardEvent<HTMLElement>): number {
  const rtl = e.currentTarget.closest('[dir]')?.getAttribute('dir') === 'rtl';
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') return e.key === 'ArrowDown' || !rtl ? 1 : -1;
  if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') return e.key === 'ArrowUp' || !rtl ? -1 : 1;
  return 0;
}

/**
 * A horizontal, snapping rail of live mini characters, each wearing its option
 * (what you see is what you get). `radio`: one choice, arrow keys move it.
 * `check`: independent toggles (face features). Blocked options stay focusable,
 * read as disabled, and explain themselves on tap.
 */
export function OptionRail<T extends string>({ label, options, isOn, onPick, mode = 'radio', name, zoom, note }: {
  label: string; options: ReadonlyArray<RailOption<T>>; isOn: (v: T) => boolean; onPick: (v: T) => void;
  mode?: 'radio' | 'check'; name: string;
  /** Close-up on the face (features are small at card size) */
  zoom?: boolean;
  /** A line above the rail ("✦ Suggested for Designer") */
  note?: ReactNode;
}) {
  const rid = useId();
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const rail = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<{ value: T; reason: string; n: number } | null>(null);

  useEffect(() => {
    if (!tip) return;
    const t = setTimeout(() => setTip(null), TIP_MS);
    return () => clearTimeout(t);
  }, [tip]);

  // Bring the chosen card into view when the rail opens (it can sit past the fold).
  useEffect(() => {
    const i = options.findIndex((o) => isOn(o.value));
    const el = refs.current[i];
    const box = rail.current;
    if (!el || !box || mode !== 'radio') return;
    const over = el.offsetLeft + el.offsetWidth - (box.scrollLeft + box.clientWidth);
    if (over > 0 || el.offsetLeft < box.scrollLeft) box.scrollLeft = Math.max(0, el.offsetLeft - 16);
    // On open only; picking scrolls itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tap = (o: RailOption<T>) => {
    if (o.blocked) {
      haptic.soft();
      setTip((t) => ({ value: o.value, reason: o.blocked!, n: (t?.n ?? 0) + 1 }));
      return;
    }
    setTip(null);
    if (mode === 'radio' && isOn(o.value)) return;
    onPick(o.value);
  };

  const onKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    if (mode !== 'radio') return;
    const step = arrowStep(e);
    if (!step) return;
    e.preventDefault();
    const n = (i + step + options.length) % options.length;
    refs.current[n]?.focus();
    refs.current[n]?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    tap(options[n]);
  };

  const focusable = Math.max(0, options.findIndex((o) => isOn(o.value)));
  const tipFor = tip && options.find((o) => o.value === tip.value);

  return (
    <div className="vx-rail-wrap">
      {note && <div className="vx-rail-note">{note}</div>}
      <div ref={rail} className={`vx-rail${zoom ? ' zoom' : ''}`} role={mode === 'radio' ? 'radiogroup' : 'group'} aria-label={label}>
        {options.map((o, i) => {
          const on = isOn(o.value);
          const why = o.blocked ? `${rid}-why-${i}` : undefined;
          return (
            <button key={o.value} ref={(el) => { refs.current[i] = el; }} type="button"
              role={mode === 'radio' ? 'radio' : 'checkbox'} aria-checked={on} aria-disabled={o.blocked ? true : undefined}
              aria-describedby={why} tabIndex={mode === 'radio' ? (i === focusable ? 0 : -1) : 0}
              className={`vx-look-card${o.blocked ? ' blocked' : ''}${tip?.value === o.value ? ' vx-shake' : ''}`}
              data-tip={tip?.value === o.value ? tip.n : undefined}
              style={{ '--i': i } as CSSProperties}
              onClick={() => tap(o)} onKeyDown={(e) => onKey(e, i)}>
              <span className="vx-look-mini" aria-hidden="true">
                <Cloud look={o.look} size={zoom ? 108 : 64} stage={4} lod="card" still label={`${name} · ${o.label}`} />
              </span>
              <span className="vx-look-card-label">{o.label}</span>
              {o.suggested && <span className="vx-look-card-spark" aria-hidden="true">✦</span>}
              {on && <span className="vx-look-card-check" aria-hidden="true"><Icon name="check" size={12} width={3} /></span>}
              {why && <span id={why} hidden>{o.blocked}</span>}
            </button>
          );
        })}
      </div>
      {tipFor && (
        <div key={tip!.n} className="vx-rail-tip" role="tooltip">
          <Icon name="info" size={16} />
          <span><b>{tipFor.label}</b> · {tip!.reason}</span>
        </div>
      )}
    </div>
  );
}
