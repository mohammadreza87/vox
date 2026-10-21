'use client';

import { useEffect, useRef, useState } from 'react';
import type { AgentView } from '../../_lib/client';

/** interaction §5.4: what the Telegram photo is doing right now. */
export type SyncState = 'in-sync' | 'syncing' | 'synced' | 'error-photo' | 'error-other' | 'outdated';

/** How long "Updated in Telegram" holds before settling (motion §4.11). */
export const SYNCED_MS = 2400;

export function syncState(agent: AgentView): SyncState {
  const s = agent.profileSync;
  if (s?.status === 'pending') return 'syncing';
  if (s?.status === 'error') return s.failed.includes('photo') ? 'error-photo' : 'error-other';
  return agent.look.avatarStale ? 'outdated' : 'in-sync';
}

/**
 * The state to draw: `syncState`, plus a 2.4 s "synced" beat whenever a push
 * or a retry settles (syncing/error → in-sync). Each caller derives it from the
 * same agent, so a ring and a label placed apart stay in step.
 */
export function useSyncState(agent: AgentView): SyncState {
  const base = syncState(agent);
  const prev = useRef(base);
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    const was = prev.current;
    prev.current = base;
    if (base !== 'in-sync') { setFlash(false); return; }
    if (was !== 'syncing' && was !== 'error-photo' && was !== 'error-other') return;
    setFlash(true);
    const t = setTimeout(() => setFlash(false), SYNCED_MS);
    return () => clearTimeout(t);
  }, [base]);
  return flash && base === 'in-sync' ? 'synced' : base;
}

/** Wall clock that ticks every `ms` while `on`; for countdowns and elapsed timers. */
export function useNow(on: boolean, ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [on, ms]);
  return now;
}

/** 0:07 · 4:12 (tabular in the UI). */
export const clock = (seconds: number) => {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

const STEP_LABEL: Record<string, string> = {
  webhook: 'connection', name: 'name', photo: 'photo', 'short description': 'short description', description: 'description',
  commands: 'commands', token: 'bot token', profile: 'profile', inactive: 'bot',
};

/** "name and description" from failed profile steps. */
export function stepList(failed: string[]): string {
  const words = [...new Set(failed.map((f) => STEP_LABEL[f] ?? f))];
  if (words.length < 2) return words[0] ?? 'profile';
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}
