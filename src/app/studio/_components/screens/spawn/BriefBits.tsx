'use client';

import { motion } from 'framer-motion';
import { useEffect, useRef } from 'react';
import type { PackId } from '@/lib/studio/skills/types';
import type { Hue } from '@/lib/studio/types';
import { haptic } from '../../../_lib/client';
import { Cloud, type Expression } from '../../Cloud';
import { Icon } from '../../ui';
import type { SpawnCopy } from './copy';
import { CLOUD_SPRING, useSpawnMotion } from './motion';

/** Overline, title and one line, with the step's single animated cloud at the inline end. */
export function BriefHeader({ t, hue, expr, successorName, successor }: {
  t: SpawnCopy; hue: Hue; expr: Expression; successor: boolean; successorName?: string;
}) {
  const m = useSpawnMotion();
  return (
    <header className="vx-brief-head">
      <div>
        <span className="vx-over">{successor ? (successorName ? t.overlineSuccessor(successorName) : t.overlineSuccessorPending) : t.overline}</span>
        <h1 className="vx-title">{successorName ? t.titleSuccessor(successorName) : t.title}</h1>
        <p className="vx-2 vx-catalog-layout-02419cff" >{t.sub}</p>
      </div>
      <motion.div key={hue} className="vx-brief-cloud" aria-hidden="true"
        initial={m.reduce ? { opacity: 0 } : { opacity: 0, scale: 0.92 }}
        animate={{ opacity: 1, scale: 1, transition: m.reduce ? { duration: 0.12 } : { opacity: { duration: 0.32 }, scale: CLOUD_SPRING } }}>
        <Cloud look={{ hue, family: 'puff', features: { cheeks: true, lashes: false, brows: false } }} size={64} stage={3} expr={expr} label="" />
      </motion.div>
    </header>
  );
}

/** Level-1 templates: one chip per pack, shown only while the brief is empty. */
export function PackRow({ t, packs, onPick }: { t: SpawnCopy; packs: PackId[]; onPick: (pack: PackId) => void }) {
  return (
    <div className="vx-catalog-layout-379fabac">
      <span className="vx-over" id="vx-pack-row">{t.packRow}</span>
      <div className="vx-packs" role="group" aria-labelledby="vx-pack-row">
        {packs.map((p) => (
          <button key={p} type="button" className="vx-chip vx-hit" onClick={() => { haptic.select(); onPick(p); }}>{t.packShort[p]}</button>
        ))}
      </div>
    </div>
  );
}

/** Points to the inline end and flips under RTL. */
export function ChevronEnd({ size = 16 }: { size?: number }) {
  return <span className="vx-mirror vx-catalog-layout-d348b10f" ><Icon name="chevronEnd" size={size} width={2} /></span>;
}

/** A quiet text action with a trailing chevron ("Browse roles ›", "Change ›"). */
export function LinkButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className="vx-link" onClick={onClick}>
      {label}<ChevronEnd />
    </button>
  );
}

/** "Custom agent" with Undo for a few seconds after a detach, then a way back to the library. */
export function CustomLine({ t, label, onUndo, onBrowse }: { t: SpawnCopy; label?: string; onUndo?: () => void; onBrowse?: () => void }) {
  return (
    <div className="vx-custom-line">
      <span dir="auto" className="vx-ellipsis vx-catalog-layout-d529e1f5" >
        {label ?? t.custom}{onUndo && <span className="vx-3"> · {t.keepingCustom}</span>}
      </span>
      {onUndo
        ? <button type="button" className="vx-link vx-link-strong" onClick={() => { haptic.select(); onUndo(); }}>{t.undo}</button>
        : onBrowse && <LinkButton label={t.browse} onClick={onBrowse} />}
    </div>
  );
}

/** The draft failure, inline above the dock (the step's only role="alert"). */
export function DraftError({ t, message, onRetry }: { t: SpawnCopy; message: string; onRetry: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' }); }, [message]);
  return (
    <div ref={ref} className="vx-banner danger vx-draft-error" role="alert">
      <Icon name="warn" size={18} className="vx-catalog-layout-17d2f14f" />
      <div className="vx-catalog-layout-46818528">
        <span className="vx-catalog-layout-3e0ed9c0">{message.replace(/\.\s*$/, '')}. {t.errorSuffix}</span>
        <button type="button" className="vx-link vx-link-strong vx-catalog-layout-f08f579b"  onClick={onRetry}>
          {t.retry}<ChevronEnd />
        </button>
      </div>
    </div>
  );
}
