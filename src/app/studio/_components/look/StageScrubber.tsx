'use client';

import { useEffect, useId, useRef, type CSSProperties } from 'react';
import type { Stage } from '@/lib/studio/types';
import { haptic } from '../../_lib/haptics';
import { STAGE_DAY, STAGE_NAME } from './lookOptions';

const STAGES: readonly Stage[] = [1, 2, 3, 4];
/** Auto-play beat per stage (interaction §4.2: 1→4 over 2.4 s). */
export const TOUR_STEP_MS = 600;
const tourKey = (id: string) => `vx:look-tour:${id}`;

function toured(id: string): boolean {
  try { return window.localStorage.getItem(tourKey(id)) === '1'; } catch { return false; }
}
function markToured(id: string) {
  try { window.localStorage.setItem(tourKey(id), '1'); } catch { /* private mode: tours again next time */ }
}

export const stageText = (s: Stage) => `Day ${STAGE_DAY[s]} · ${STAGE_NAME[s]}`;

/**
 * Preview how the character grows: Day 1 · 3 · 5 · 7. A native range input
 * (keyboard, screen readers, detents) under a drawn track. On an agent's first
 * visit it plays 1→4 once, then rests on `rest` (the real stage; 4 for drafts).
 */
export function StageScrubber({ agentId, value, rest, onChange, name, draft, reduced }: {
  agentId: string; value: Stage; rest: Stage; onChange: (s: Stage) => void; name: string; draft: boolean; reduced?: boolean;
}) {
  const id = useId();
  const change = useRef(onChange);
  change.current = onChange;
  const touring = useRef(false);

  useEffect(() => {
    if (reduced || toured(agentId)) return;
    markToured(agentId);
    touring.current = true;
    const timers = STAGES.map((s, i) => setTimeout(() => {
      if (!touring.current) return;
      haptic.select();
      change.current(s);
    }, i * TOUR_STEP_MS));
    timers.push(setTimeout(() => {
      if (touring.current) change.current(rest);
      touring.current = false;
    }, STAGES.length * TOUR_STEP_MS + 300));
    return () => { touring.current = false; timers.forEach(clearTimeout); };
    // Once per mount: the tour runs on first entry only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId]);

  const pick = (s: Stage) => {
    touring.current = false;
    if (s === value) return;
    haptic.select();
    change.current(s);
  };

  const atRest = value === rest;
  const caption = draft && atRest ? 'Fully formed (day 7)'
    : !draft && atRest ? `Today · ${stageText(rest)}`
    : `Scrub to preview how ${name} grows`;

  return (
    <div className="vx-stage" style={{ '--at': (value - 1) / 3 } as CSSProperties}>
      <div className="vx-stage-track" aria-hidden="true">
        <span className="vx-stage-fill" />
        {STAGES.map((s) => <span key={s} className="vx-stage-node" data-on={s <= value || undefined} data-rest={s === rest || undefined} style={{ '--i': (s - 1) / 3 } as CSSProperties} />)}
        <span className="vx-stage-thumbrail"><span className="vx-stage-thumb" /></span>
      </div>
      <input id={id} className="vx-stage-input" type="range" min={1} max={4} step={1} value={value}
        aria-label={`Preview ${name}’s growth`} aria-valuetext={stageText(value)}
        onPointerDown={() => { touring.current = false; }}
        onChange={(e) => pick(Number(e.target.value) as Stage)} />
      <div className="vx-stage-labels" aria-hidden="true">
        {STAGES.map((s) => (
          <button key={s} type="button" tabIndex={-1} data-on={s === value || undefined} onClick={() => pick(s)}>Day {STAGE_DAY[s]}</button>
        ))}
      </div>
      <p className="vx-stage-caption" key={caption}>{caption}</p>
    </div>
  );
}
