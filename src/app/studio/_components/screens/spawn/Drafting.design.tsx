'use client';

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { PRESET_LOOKS, PALETTE } from '@/lib/studio/character';
import type { CharacterLook } from '@/lib/studio/types';
import { haptic } from '../../../_lib/haptics';
import type { Locale } from '../../../_lib/i18n';
import { spawnCopy } from '../../../_lib/spawn-copy';
import { Cloud, type CloudMoment } from '../../Cloud';
import { ProgressPill } from '../../motion/ProgressPill';
import { useTier } from '../../motion/tier';

/** Claude drafts take 5–20 s; the bar's time constant is the median. */
const TAU = 12;
const CYCLE_MS = 1600;
const SIZE = 168;
/** The poof (≈420 ms) plus its 1.2 s hold, with slack */
const POOF_MAX_MS = 2200;

/** Sample looks in a stable shuffled order, so the forming creature never repeats itself back to back. */
function useSamples(): CharacterLook[] {
  return useMemo(() => {
    const a = [...PRESET_LOOKS];
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }, []);
}

/**
 * Claude is drafting (motion §4.9, interaction §3.4.2). One rig morphs between sample looks every
 * 1.6 s (squash-swap, never a remount) while vapor gathers inward, under a progress pill. When the
 * draft's `look` arrives: one last gather beat, then it poofs into the drafted look and calls
 * `onDone`. With `heroId` the face can fly on into the persona header. `locale` defaults to English.
 */
export function Drafting({ look, onDone, onCancel, heroId, locale = 'en' }: { look?: CharacterLook | null; onDone?: () => void; onCancel?: () => void; heroId?: string; locale?: Locale } = {}) {
  const c = spawnCopy[locale];
  const t = c.drafting;
  const reduced = useTier() === 'reduced';
  const samples = useSamples();
  const [i, setI] = useState(0);
  const [moment, setMoment] = useState<CloudMoment | null>(null);
  const arrived = !!look;
  useEffect(() => {
    if (arrived || reduced) return;
    const t = setInterval(() => setI((n) => (n + 1) % samples.length), CYCLE_MS);
    return () => clearInterval(t);
  }, [arrived, reduced, samples.length]);

  // the draft landed: a 300 ms gather, then the poof into the real look
  const finished = useRef(onDone);
  finished.current = onDone;
  const doneOnce = useRef(false);
  const done = () => { if (doneOnce.current) return; doneOnce.current = true; finished.current?.(); };
  useEffect(() => {
    if (!arrived) return;
    if (reduced) { haptic.success(); done(); return; }
    const t = setTimeout(() => setMoment({ kind: 'poof', key: 'drafted' }), 300);
    // a poof that never reports back (off screen, interrupted) still lets the wizard move on
    const safety = setTimeout(done, 300 + POOF_MAX_MS);
    return () => { clearTimeout(t); clearTimeout(safety); };
  }, [arrived, reduced]);

  // The drafted look swaps in with the poof (its hidden first frame), never before it: no early reveal (motion §4.9)
  const shown = look && (moment || reduced) ? look : samples[i];
  const glow = (PALETTE[shown.hue] ?? PALETTE.lilac).glow;
  return (
    <div className="vx-drafting">
      <div className="vx-drafting-stage" style={{ width: SIZE + 80, height: SIZE + 40 }}>
        {!reduced && (
          <span className={`vx-gather${arrived ? ' last' : ''}`} aria-hidden="true" style={{ '--gather': glow } as CSSProperties}>
            {Array.from({ length: 6 }, (_, n) => <span key={n} style={{ '--a': `${n * 60 + 15}deg`, animationDelay: `${n * 0.2}s` } as CSSProperties} />)}
          </span>
        )}
        <Cloud look={shown} size={SIZE} lod="hero" stage={moment ? 4 : 3} expr={moment ? 'idle' : 'thinking'} heroId={heroId}
          label={moment ? t.newAgent : t.drafting} moment={moment} onMomentEnd={done} />
      </div>
      <div className="vx-title-m">{t.title}</div>
      <p className="vx-2" style={{ margin: 0, maxWidth: 280 }}>{t.body}</p>
      <ProgressPill active={!arrived} labels={t.labels} tau={TAU} done={t.ready} slow={c.slow} />
      {onCancel && !arrived && <button type="button" className="vx-btn vx-btn-ghost vx-btn-sm" onClick={onCancel}>{t.stop}</button>}
    </div>
  );
}
