'use client';
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { guestRightsCopy } from '@/lib/adaptive/guest-rights/notice';
import type { GuestOperatorInput } from '@/lib/adaptive/guest-rights/contracts';
import { guestRightsApi, GuestClientError, type GuestQueue } from '../_lib/guest-rights-client';
import { tg } from '../_lib/client';
import { haptic } from '../_lib/haptics';
import { Banner, Icon, SkeletonRows, Spinner } from './ui';
export function GuestRightsOperationsPanel({ locale = 'en', sessionKey = tg()?.initData ?? '' }: {
    locale?: 'en' | 'fa';
    sessionKey?: string;
}) {
    const [queue, setQueue] = useState<GuestQueue>(), [hidden, setHidden] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(false), [confirm, setConfirm] = useState<{
        id: string;
        action: GuestOperatorInput['action'];
    }>();
    const generation = useRef(0), active = useRef<AbortController | null>(null), authorized = useRef(false), c = guestRightsCopy[locale];
    const refresh = useCallback(async () => { const gen = ++generation.current; active.current?.abort(); const controller = new AbortController(); active.current = controller; setQueue(undefined); setBusy(true); setError(false); setConfirm(undefined); try {
        const value = await guestRightsApi.operations(sessionKey, controller.signal);
        if (gen !== generation.current)
            return;
        setQueue(value);
        authorized.current = true;
        setHidden(false);
    }
    catch (e) {
        if (gen !== generation.current)
            return;
        if (e instanceof GuestClientError && [401, 403, 503].includes(e.status)) { authorized.current = false; setHidden(true); }
        else if (authorized.current) {
            setHidden(false);
            setError(true);
        } else { setHidden(true); setError(false); }
    }
    finally {
        if (gen === generation.current)
            setBusy(false);
    } }, [sessionKey]);
    useLayoutEffect(() => { const epoch = generation, request = active; authorized.current = false; setQueue(undefined); setHidden(true); void refresh(); return () => { epoch.current++; request.current?.abort(); }; }, [refresh]);
    async function operate(row: GuestQueue['requests'][number], action: GuestOperatorInput['action']) { if (busy || !queue)
        return; const gen = ++generation.current, controller = new AbortController(); active.current?.abort(); active.current = controller; setBusy(true); setConfirm(undefined); try {
        await guestRightsApi.operate(sessionKey, { version: 1, requestId: row.requestId, eventId: crypto.randomUUID(), expectedRevision: row.revision, expectedPolicyRevision: queue.policyRevision, action, operationHandle: row.operationHandle }, controller.signal);
        if (gen === generation.current)
            await refresh();
    }
    catch {
        if (gen === generation.current) {
            setQueue(undefined);
            setError(true);
            setBusy(false);
        }
    } }
    if (hidden)
        return null;
    const fa = locale === 'fa';
    return <section className="vx-section vx-ops sentry-block" dir={fa ? 'rtl' : 'ltr'} lang={locale} aria-label={c.operations} aria-busy={busy} data-guest-rights-private="true">
      <div className="vx-section-head">
        <h2 className="vx-over">{c.operations}</h2>
        <button type="button" className="vx-icon-btn" disabled={busy} onClick={() => void refresh()} aria-label={c.refresh}>{busy ? <Spinner /> : <Icon name="refresh" size={18} />}</button>
      </div>
      <p className="vx-section-foot vx-diag-lede">{c.operationsIntro}</p>
      {error && <Banner tone="danger">{c.unknownOutcome}</Banner>}
      {busy && !queue && <SkeletonRows rows={2} lead={false} label={c.pending} />}
      {queue && <div className="vx-group">
        {!queue.requests.length && <div className="vx-row"><span className="vx-row-sub">{fa ? 'درخواستی در صف نیست.' : 'No requests in the queue.'}</span></div>}
        {queue.requests.map(row => <article key={row.requestId} className="vx-row top vx-ops-item" aria-label={`${c.kinds[row.kind]} · ${row.requestId}`}>
          <span className="vx-row-main">
            <span className="vx-ops-title"><span className="vx-row-title">{c.kinds[row.kind]}</span><span className="vx-pill">{c[row.context]}</span></span>
            <span className="vx-row-sub vx-ops-state">{c.states[row.state]}</span>
            <code className="vx-ref"><bdi>{row.requestId}</bdi></code>
            <span className="vx-row-sub vx-3">{c.effect}</span>
            <span className="vx-ops-actions">
              {(['begin_review', 'request_requester_action', 'mark_operator_pending', 'close_unfulfilled', 'reassess_retention', 'purge_terminal_record'] as const)
                .filter(action => row.state === 'closed_unfulfilled' ? ['reassess_retention', 'purge_terminal_record'].includes(action) : action !== 'purge_terminal_record' && (action !== 'begin_review' || row.state === 'received'))
                .map(action => {
                  const label = { begin_review: c.begin, request_requester_action: c.ask, mark_operator_pending: c.mark, close_unfulfilled: c.operatorClose, reassess_retention: c.reassess, purge_terminal_record: c.purge }[action];
                  const destructive = action === 'close_unfulfilled' || action === 'purge_terminal_record';
                  return <button key={action} type="button" className={`vx-btn vx-btn-xs ${destructive ? 'vx-btn-ghost vx-danger-text' : action === 'begin_review' ? 'vx-btn-tonal' : ''}`} disabled={busy}
                    onClick={() => { if (destructive) { haptic.warn(); setConfirm({ id: row.requestId, action }); } else void operate(row, action); }}>{label}</button>;
                })}
            </span>
            {confirm?.id === row.requestId && <div className="vx-you-confirm" role="group" aria-label={c.operatorClose}>
              <p className="vx-small">{confirm.action === 'purge_terminal_record' ? c.confirmPurge : c.confirmClose}</p>
              <div className="vx-dock-row">
                <button type="button" className="vx-btn vx-btn-secondary vx-btn-sm" disabled={busy} onClick={() => setConfirm(undefined)}>{c.cancel}</button>
                <button type="button" className="vx-btn vx-btn-danger vx-btn-sm" disabled={busy} onClick={() => void operate(row, confirm.action)}>{c.confirm}</button>
              </div>
            </div>}
          </span>
        </article>)}
      </div>}
    </section>;
}
