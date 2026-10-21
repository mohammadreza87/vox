'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Stage } from '@/lib/studio/types';
import type { CloudMoment } from '../Cloud';

const key = (agentId: string) => `vx:stage-seen:${agentId}`;

function seenStage(agentId: string): Stage | null {
  try {
    const raw = window.localStorage.getItem(key(agentId));
    const n = raw === null ? NaN : Number(raw);
    return n >= 1 && n <= 4 ? n as Stage : null;
  } catch { return null; }
}
/** Records the stage this device has seen. Private mode can't store it: the moment then replays next visit. */
export function markStageSeen(agentId: string, stage: Stage) {
  try { window.localStorage.setItem(key(agentId), String(stage)); } catch { /* private mode */ }
}

/**
 * The stage this device last saw the agent at, or null before its first view. Until the stage-up plays,
 * every face of a grown agent (Home's card, the hero flight) shows this one, so nothing spoils the reveal.
 */
export const seenStageFor = (agentId: string): Stage | null => seenStage(agentId);

/** True when an active agent has grown since this device last saw it (Home shows a volt dot). */
export function hasUnseenStage(agentId: string, stage: Stage): boolean {
  const seen = seenStage(agentId);
  return seen !== null && seen < stage;
}

const FRESH = 'vx:fresh-agent';
/** Spawn marks the agent it just drafted, so its first Home card plays the entrance poof (motion §4.7). */
export function markFreshAgent(agentId: string) {
  try { window.localStorage.setItem(FRESH, agentId); } catch { /* private mode: no poof */ }
}
export function isFreshAgent(agentId: string): boolean {
  try { return window.localStorage.getItem(FRESH) === agentId; } catch { return false; }
}
/** The card has shown its entrance: it never replays. */
export function clearFreshAgent(agentId: string) {
  try { if (window.localStorage.getItem(FRESH) === agentId) window.localStorage.removeItem(FRESH); } catch { /* private mode */ }
}

/** The pending stage-up for an agent, if any; the first view of an agent only records its stage. */
function pending(agentId: string, stage: Stage, status: string): CloudMoment | null {
  if (status !== 'active' || typeof window === 'undefined') return null;
  const seen = seenStage(agentId);
  if (seen === null) { markStageSeen(agentId, stage); return null; }
  return seen < stage ? { kind: 'evolve', key: `${agentId}:${stage}`, fromStage: seen } : null;
}

/**
 * Plays the stage-up moment once per stage per device (motion §4.8). Pass `moment` to the agent's
 * Cloud, show `pill` under the name while it plays, and call `done()` from `onMomentEnd`; the stage
 * is recorded only then, so leaving mid-way replays it. Computed on first render, so the hero never
 * paints one frame at the new stage before the moment starts.
 */
export function useStageUp(agentId: string, stage: Stage, status: string, name?: string): { moment: CloudMoment | null; pill: string | null; done(): void } {
  const [moment, setMoment] = useState<CloudMoment | null>(() => pending(agentId, stage, status));
  useEffect(() => {
    setMoment((m) => (m?.key === `${agentId}:${stage}` ? m : pending(agentId, stage, status)));
  }, [agentId, stage, status]);
  const done = useCallback(() => { markStageSeen(agentId, stage); setMoment(null); }, [agentId, stage]);
  const pill = moment ? `${name ? `${name} grew · ` : ''}stage ${stage} of 4` : null;
  return { moment, pill: pill && (name ? pill : pill[0].toUpperCase() + pill.slice(1)), done };
}
