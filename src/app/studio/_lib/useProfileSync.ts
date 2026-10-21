'use client';

import { useEffect, useRef, useState } from 'react';
import { api, tg, type AgentView } from './client';

export const POLL_MS = 3000;
/** Error without a server retryAt: 6 s, 12 s, 24 s … capped at a minute (a read can trigger the lazy reconcile). */
const BACKOFF_MS = 6000;
const BACKOFF_CAP_MS = 60_000;
/** Two hooks on one agent (profile hero + photo sheet) share a read this fresh instead of fetching twice. */
const SHARE_MS = 2000;

type Shared = { refs: number; at: number; read?: Promise<AgentView> };
const shared = new Map<string, Shared>();

/** One GET per agent at a time; a read that landed under SHARE_MS ago is reused. */
function readAgent(id: string): Promise<AgentView> {
  const s = shared.get(id);
  if (s?.read && Date.now() - s.at < SHARE_MS) return s.read;
  const read = api.agent(id).then((r) => r.agent);
  if (s) { s.read = read; s.at = Date.now(); read.catch(() => { if (s.read === read) s.read = undefined; }); }
  return read;
}

/** ms until the next status read, or null when nothing should poll. */
export function nextProfileRead(sync: AgentView['profileSync'], errors: number, now = Date.now()): number | null {
  if (!sync || sync.status === 'synced') return null;
  if (sync.status === 'pending') return POLL_MS;
  const at = sync.retryAt ? Date.parse(sync.retryAt) : NaN;
  if (Number.isFinite(at)) return Math.max(POLL_MS, at - now);
  return Math.min(BACKOFF_CAP_MS, BACKOFF_MS * 2 ** Math.min(errors, 4));
}

type TelegramEvents = { onEvent?(e: string, cb: () => void): void; offEvent?(e: string, cb: () => void): void };

/**
 * Keeps an active agent's Telegram profile status fresh: polls every 3 s while
 * a push is pending, waits until retryAt after an error (or backs off when the
 * server gave none), stops once synced, and rereads when the Mini App comes
 * back to the foreground. A read that started before the agent changed locally
 * (a choose or retry landed meanwhile) is dropped, so it never reverts newer state.
 */
export function useProfileSync(agent: AgentView | null, onUpdate: (a: AgentView) => void): void {
  const update = useRef(onUpdate);
  update.current = onUpdate;
  const version = useRef(0);
  const errors = useRef(0);
  const [tick, setTick] = useState(0);
  const id = agent?.id;
  const active = agent?.status === 'active';
  const status = agent?.profileSync?.status;
  const retryAt = agent?.profileSync?.retryAt;

  // Any new agent object (from a poll or a local action) invalidates reads in flight.
  useEffect(() => { version.current++; }, [agent]);
  useEffect(() => { if (status !== 'error') errors.current = 0; }, [status]);

  useEffect(() => {
    if (!id) return;
    const s = shared.get(id) ?? { refs: 0, at: 0 };
    s.refs++;
    shared.set(id, s);
    return () => { if (--s.refs === 0 && shared.get(id) === s) shared.delete(id); };
  }, [id]);

  useEffect(() => {
    if (!id || !active) return;
    const wait = nextProfileRead(status ? { status, failed: [], retryAt } : undefined, errors.current);
    if (wait === null) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') { setTick((n) => n + 1); return; } // `activated` rereads
      const v = version.current;
      try {
        const next = await readAgent(id);
        if (cancelled) return;
        if (v === version.current) {
          if (next.profileSync?.status === 'error') errors.current++;
          update.current(next);
        }
      } catch { /* the next tick or `activated` retries */ }
      if (!cancelled) setTick((n) => n + 1);
    }, wait);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [id, active, status, retryAt, tick]);

  useEffect(() => {
    const app = tg() as (ReturnType<typeof tg> & TelegramEvents) | null;
    if (!id || !active || !app?.onEvent) return;
    const refresh = () => {
      const v = version.current;
      readAgent(id).then((a) => { if (v === version.current) update.current(a); }).catch(() => undefined);
    };
    app.onEvent('activated', refresh);
    return () => app.offEvent?.('activated', refresh);
  }, [id, active]);
}
