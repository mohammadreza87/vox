'use client';
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { guestRightsCopy } from '@/lib/adaptive/guest-rights/notice';
import type { GuestOperatorInput } from '@/lib/adaptive/guest-rights/contracts';
import { guestRightsApi, GuestClientError, type GuestQueue } from '../_lib/guest-rights-client';
import { tg } from '../_lib/client';
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
    return <section className="vx-card vx-privacy-card sentry-block" dir={locale === 'fa' ? 'rtl' : 'ltr'} data-guest-rights-private="true"><h2 className="vx-head">{c.operations}</h2><p className="vx-small">{c.operationsIntro}</p><button className="vx-btn vx-btn-secondary" disabled={busy} onClick={() => void refresh()}>{c.refresh}</button>{error && <p role="alert">{c.unknownOutcome}</p>}{busy && <p role="status">{c.pending}</p>}{queue?.requests.map(row => <article key={row.requestId}><h3><bdi>{row.requestId}</bdi></h3><p>{c.kinds[row.kind]} · {c[row.context]} · {c.states[row.state]}</p><p>{c.effect}</p><div className="vx-privacy-actions">{(['begin_review', 'request_requester_action', 'mark_operator_pending', 'close_unfulfilled', 'reassess_retention', 'purge_terminal_record'] as const).filter(action => row.state === 'closed_unfulfilled' ? ['reassess_retention', 'purge_terminal_record'].includes(action) : action !== 'purge_terminal_record' && (action !== 'begin_review' || row.state === 'received')).map(action => { const label = { begin_review: c.begin, request_requester_action: c.ask, mark_operator_pending: c.mark, close_unfulfilled: c.operatorClose, reassess_retention: c.reassess, purge_terminal_record: c.purge }[action]; return <button key={action} className="vx-btn vx-btn-secondary" disabled={busy} onClick={() => { if (action === 'close_unfulfilled' || action === 'purge_terminal_record')
        setConfirm({ id: row.requestId, action });
    else
        void operate(row, action); }}>{label}</button>; })}</div>{confirm?.id === row.requestId && <div><p>{confirm.action === 'purge_terminal_record' ? c.confirmPurge : c.confirmClose}</p><button className="vx-btn vx-btn-danger" disabled={busy} onClick={() => void operate(row, confirm.action)}>{c.confirm}</button><button className="vx-btn vx-btn-secondary" disabled={busy} onClick={() => setConfirm(undefined)}>{c.cancel}</button></div>}</article>)}</section>;
}
