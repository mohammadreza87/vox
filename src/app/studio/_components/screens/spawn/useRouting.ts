'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type RouteSuggestion } from '../../../_lib/client';
import { asSuggestion, routable, ROUTING } from './routing';

interface Last { text: string; final: boolean; suggestion: RouteSuggestion }

/**
 * Brief → role routing.
 *
 * While typing: one debounced call per pause with `final: false`, which the
 * server answers from its local keyword router (no third-party call). A new
 * keystroke cancels the pending or in-flight call.
 *
 * On Draft: `finalize()` routes the current text once with `final: true`
 * (Decisions-backed on the server, when it has Decisions) within a short
 * budget, falling back to the last local answer for the same text. A final
 * call cancels any pending typing route so a stale local answer can't land
 * over it, and every call is aborted when the step unmounts.
 */
export function useRouting({ text, enabled, exclude, answer, onSuggest }: {
  text: string;
  enabled: boolean;
  exclude: string[];
  answer?: string;
  onSuggest: (s: RouteSuggestion, text: string) => void;
}) {
  const [inFlight, setInFlight] = useState(false);
  const last = useRef<Last | null>(null);
  const typing = useRef<AbortController | null>(null);
  const finals = useRef(new Set<AbortController>());
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const active = useRef(0);
  const latest = useRef({ exclude, answer, onSuggest });
  latest.current = { exclude, answer, onSuggest };

  const stopTyping = useCallback(() => {
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = null;
    typing.current?.abort();
    typing.current = null;
  }, []);

  /** `submit` calls (Draft, clarifier answer) outlive typing and are aborted only on unmount. */
  const call = useCallback(async (t: string, final: boolean, opts: { answer?: string; timeoutMs?: number; submit?: boolean } = {}) => {
    const controller = new AbortController();
    // Any newer call supersedes a pending or in-flight typing route.
    stopTyping();
    if (opts.submit) finals.current.add(controller); else typing.current = controller;
    active.current += 1;
    setInFlight(true);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const { exclude: ex, answer: ans } = latest.current;
      const a = opts.answer ?? ans;
      const body = { text: t, final, ...(ex.length ? { exclude: ex } : {}), ...(a ? { answer: a } : {}) };
      const request = Promise.resolve().then(() => api.route(body, controller.signal));
      const raw = opts.timeoutMs
        ? await Promise.race([request, new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('timeout')); }, opts.timeoutMs); })])
        : await request;
      if (controller.signal.aborted) return null;
      const s = asSuggestion(raw);
      if (s) last.current = { text: t, final, suggestion: s };
      return s;
    } catch {
      return null;
    } finally {
      if (timer) clearTimeout(timer);
      if (typing.current === controller) typing.current = null;
      finals.current.delete(controller);
      active.current -= 1;
      if (!active.current) setInFlight(false);
    }
  }, [stopTyping]);

  useEffect(() => {
    stopTyping();
    const t = text.trim();
    if (!enabled || !routable(t) || last.current?.text === t) return;
    debounce.current = setTimeout(async () => {
      debounce.current = null;
      const s = await call(t, false);
      if (s) latest.current.onSuggest(s, t);
    }, ROUTING.debounceMs);
    return stopTyping;
  }, [text, enabled, call, stopTyping]);

  useEffect(() => {
    const pending = finals.current;
    return () => {
      stopTyping();
      for (const c of pending) c.abort();
    };
  }, [stopTyping]);

  /**
   * The routed answer for `t`: with Decisions (`decisions`) one final call
   * unless one already answered this text; without, the local answer (routing
   * now only if this text was never routed). Falls back to the last local answer.
   */
  const finalize = useCallback(async (t: string, decisions: boolean) => {
    const prev = last.current?.text === t ? last.current : null;
    if (prev && (prev.final || !decisions)) return prev.suggestion;
    const s = await call(t, decisions, { timeoutMs: ROUTING.finalTimeoutMs, submit: true });
    return s ?? prev?.suggestion ?? null;
  }, [call]);

  /** Re-route after a clarifier answer (never shown again). */
  const reroute = useCallback((t: string, ans: string, decisions: boolean) =>
    call(t, decisions, { answer: ans, timeoutMs: ROUTING.finalTimeoutMs, submit: true }), [call]);

  return { inFlight, finalize, reroute };
}
