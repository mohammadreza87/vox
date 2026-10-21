'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { normalizeLook } from '@/lib/studio/character';
import type { CharacterLook } from '@/lib/studio/types';
import { ApiError, api, type AgentView } from '../../_lib/client';
import { sameLook } from './lookOptions';

/** Taps inside this window coalesce into one save (interaction §2.5). */
export const LOOK_DEBOUNCE_MS = 350;
/** How long "Saved" holds before the status settles. */
const SAVED_MS = 1600;

export type DraftStatus = 'idle' | 'saving' | 'saved' | 'error';

export interface LookDraft {
  /** What the editor shows: the server look plus every change not yet confirmed */
  look: CharacterLook;
  status: DraftStatus;
  error: string | null;
  /** Bumps on each rollback, so the caller can shake the control that failed */
  failures: number;
  set(look: CharacterLook): void;
  retry(): void;
  /** Sends any waiting change now; resolves once every save has settled (waiting out a rate limit) */
  flush(): Promise<void>;
  /**
   * Live agents: push to Telegram once the edits are in (PLAN D5). Sends at most
   * one `syncProfile({ force:false })` per batch of saved changes; a failed push
   * stays owed (the next commit retries it) and is reported through `onPushError`.
   */
  commit(): Promise<void>;
}

export interface LookDraftOptions {
  live: boolean;
  onError?: (message: string) => void;
  /** The Telegram push on leaving failed; `retry` pushes again (works after unmount) */
  onPushError?: (message: string, retry: () => void) => void;
  describe?: (e: unknown) => string;
}

/** Consecutive rate-limited saves before the change is rolled back like any other failure. */
const MAX_LIMITED = 3;

/**
 * Optimistic look edits. Every save carries the whole look, so at most one save
 * is in flight: when it settles, the latest look (if it moved on) goes next.
 * The server therefore applies saves in order and the last one it commits is
 * the look on screen. A 429 keeps the local look and resends after `retryAfter`;
 * any other failure of the latest look rolls back to the last server answer.
 */
export function useLookDraft(agent: AgentView, onUpdate: (a: AgentView) => void, o: LookDraftOptions): LookDraft {
  const [look, setLook] = useState(() => normalizeLook(agent.look));
  const [status, setStatus] = useState<DraftStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [failures, setFailures] = useState(0);

  const r = useRef({
    id: agent.id,
    /** The last look the server answered with */
    confirmed: normalizeLook(agent.look),
    local: normalizeLook(agent.look),
    /** `local` has changes not yet sent */
    waiting: false,
    timer: null as ReturnType<typeof setTimeout> | null,
    inflight: null as Promise<void> | null,
    /** A server answer held back while a newer look was waiting (delivered if that one fails) */
    undelivered: null as AgentView | null,
    /** Rate-limited: no save goes out before this */
    holdUntil: 0,
    limited: 0,
    failed: null as CharacterLook | null,
    /** Saved changes not yet pushed to Telegram */
    unsynced: false,
    alive: true,
  }).current;
  const update = useRef(onUpdate);
  update.current = onUpdate;
  const opts = useRef(o);
  opts.current = o;

  // A look that changed elsewhere (another sheet, a refetch) is taken over only while nothing is pending here.
  useEffect(() => {
    const next = normalizeLook(agent.look);
    r.id = agent.id;
    if (r.waiting || r.inflight) return;
    r.confirmed = next;
    if (!sameLook(next, r.local)) { r.local = next; setLook(next); }
  }, [agent.id, agent.look, r]);

  const schedule = useCallback((ms: number, run: () => void) => {
    if (r.timer) clearTimeout(r.timer);
    r.timer = setTimeout(run, Math.max(ms, r.holdUntil - Date.now()));
  }, [r]);

  const send = useCallback(function send() {
    if (r.timer) { clearTimeout(r.timer); r.timer = null; }
    if (!r.waiting || r.inflight) return; // one save at a time: the settle sends what's waiting
    if (Date.now() < r.holdUntil) { schedule(0, send); return; }
    r.waiting = false;
    const sent = r.local;
    const p: Promise<void> = api.setLook(r.id, sent, { sync: false }).then((res) => {
      r.unsynced = true;
      r.limited = 0;
      r.failed = null;
      r.confirmed = normalizeLook(res.agent.look);
      // A newer look goes next; its answer updates everyone (no flash of this one).
      if (r.waiting) { r.undelivered = res.agent; return; }
      r.undelivered = null;
      update.current(res.agent);
      if (r.alive) { setStatus('saved'); setError(null); }
    }, (e: unknown) => {
      if (e instanceof ApiError && e.status === 429 && ++r.limited <= MAX_LIMITED) {
        // Too many saves: keep the choice on screen and send the latest look once the window reopens.
        r.holdUntil = Date.now() + (e.retryAfter ?? 5) * 1000;
        r.waiting = true;
        if (r.alive) setStatus('saving');
        return;
      }
      r.limited = 0;
      r.failed = sent;
      const message = opts.current.describe?.(e) ?? (e instanceof Error ? e.message : 'Couldn’t save the look');
      if (r.waiting) return; // a newer change goes next
      // Roll back to the last look the server answered with (saves are serial, so it is the server's look).
      r.local = r.confirmed;
      if (r.undelivered) { update.current(r.undelivered); r.undelivered = null; }
      if (!r.alive) return;
      setLook(r.confirmed);
      setStatus('error');
      setError(message);
      setFailures((f) => f + 1);
      opts.current.onError?.(message);
    }).finally(() => {
      if (r.inflight === p) r.inflight = null;
      if (r.waiting && !r.timer) send();
    });
    r.inflight = p;
  }, [r, schedule]);

  const set = useCallback((next: CharacterLook) => {
    const n = normalizeLook(next);
    r.local = n;
    r.waiting = true;
    setLook(n);
    setStatus('saving');
    setError(null);
    schedule(LOOK_DEBOUNCE_MS, send);
  }, [r, send, schedule]);

  const flush = useCallback(async () => {
    for (;;) {
      send();
      if (r.inflight) { await r.inflight; continue; }
      if (!r.waiting) return;
      // Rate-limited: wait the window out, then send.
      await new Promise((res) => setTimeout(res, Math.max(0, r.holdUntil - Date.now())));
    }
  }, [r, send]);

  const commit = useCallback(async function commit() {
    await flush();
    if (!opts.current.live || !r.unsynced) return;
    r.unsynced = false;
    try {
      update.current((await api.syncProfile(r.id, { force: false })).agent);
    } catch (e) {
      // The look is saved, but Telegram wasn't told: stay owed so the next close (or Retry) pushes again.
      r.unsynced = true;
      const message = opts.current.describe?.(e) ?? (e instanceof Error ? e.message : 'Couldn’t update Telegram');
      opts.current.onError?.(message);
      opts.current.onPushError?.(message, () => void commit());
    }
  }, [flush, r]);

  const retry = useCallback(() => { if (r.failed) set(r.failed); }, [r, set]);

  useEffect(() => {
    if (status !== 'saved') return;
    const t = setTimeout(() => setStatus('idle'), SAVED_MS);
    return () => clearTimeout(t);
  }, [status]);

  // Leaving (Next, Done, back, sheet dismissed) sends what's waiting, then pushes once for a live agent.
  const commitRef = useRef(commit);
  commitRef.current = commit;
  useEffect(() => {
    r.alive = true;
    return () => { r.alive = false; void commitRef.current(); };
  }, [r]);

  return { look, status, error, failures, set, retry, flush, commit };
}
