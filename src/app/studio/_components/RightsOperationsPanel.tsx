'use client';
import { useCallback, useId, useLayoutEffect, useRef, useState } from 'react';
import { rightsApi, RightsClientError, type RightsOperationView, type RightsOperations } from '../_lib/rights-client';
import { rightsCopy, rightsDate, rightsState, type RightsLocale } from '../_lib/rights-copy';
import { tg } from '../_lib/client';
import { haptic } from '../_lib/haptics';
import { Banner, Icon, Spinner } from './ui';
import type { OperatorAction, RetentionAction } from '@/lib/adaptive/rights-intake/contracts';

/** A product role merely permits checking the separate server privacy-operator gate. */
export function RightsOperationsPanel({ locale = 'en', sessionKey = tg()?.initData ?? '' }: { locale?: RightsLocale; sessionKey?: string }) {
  return <OperationsPanel key={sessionKey} locale={locale} session={sessionKey} />;
}
function OperationsPanel({ locale, session }: { locale: RightsLocale; session: string }) {
  const c = rightsCopy[locale], id = useId();
  const [data, setData] = useState<RightsOperations | null>(null), [busy, setBusy] = useState(true), [unknown, setUnknown] = useState(false), [closing, setClosing] = useState<string | null>(null), [purging, setPurging] = useState<string | null>(null), [failed, setFailed] = useState(false);
  const cursor = useRef<string | undefined>(undefined), controller = useRef<AbortController | null>(null), alive = useRef(true), generation = useRef(0), lock = useRef(false);
  const valid = useCallback((g: number) => alive.current && generation.current === g && tg()?.initData === session, [session]);
  const load = useCallback(async (next?: string) => {
    if (lock.current) return;
    const g = ++generation.current, abort = new AbortController(); controller.current = abort; lock.current = true;
    cursor.current = next; setBusy(true); setUnknown(false); setFailed(false); setClosing(null); setPurging(null); setData(null);
    try { const value = await rightsApi.operations(session, next, abort.signal); if (valid(g)) setData(value); }
    catch (error) { if (valid(g) && !(error instanceof RightsClientError && [401, 403].includes(error.status))) setFailed(true); }
    finally { if (valid(g)) { setBusy(false); lock.current = false; controller.current = null; } }
  }, [session, valid]);
  const dispose = useCallback(() => { alive.current = false; controller.current?.abort(); controller.current = null; lock.current = false; }, []);
  useLayoutEffect(() => { alive.current = true; void load(); return dispose; }, [load, dispose]);
  const run = async (row: RightsOperationView, action: OperatorAction['action'] | RetentionAction['action'], reasonCode: OperatorAction['reasonCode'] = 'review_pending') => {
    const retention = action === 'reassess_retention' || action === 'purge_terminal_record';
    if (lock.current || unknown || !data || !retention && data.policyStatus !== 'available') return;
    const g = ++generation.current, abort = new AbortController(); controller.current = abort; lock.current = true; setBusy(true); setClosing(null); setPurging(null);
    try {
      if (retention) {
        if (!row.retentionPolicyRevision || !row.retentionActions?.includes(action as RetentionAction['action'])) return;
        await rightsApi.retain(row.requestId, { version: 1, eventId: crypto.randomUUID(), expectedRevision: row.revision, expectedPolicyRevision: row.retentionPolicyRevision, action: action as RetentionAction['action'], operationHandle: row.operationHandle }, session, abort.signal);
      } else await rightsApi.operate(row.requestId, { version: 1, eventId: crypto.randomUUID(), expectedRevision: row.revision, action: action as OperatorAction['action'], reasonCode, operationHandle: row.operationHandle }, session, abort.signal);
      if (!valid(g)) return;
      // Refresh current handles/authority; never rebase or replay an old mutation automatically.
      setData(null);
      const value = await rightsApi.operations(session, cursor.current, abort.signal); if (valid(g)) setData(value);
    } catch (error) { if (valid(g)) { if (error instanceof RightsClientError && [401, 403].includes(error.status)) setData(null); else setUnknown(true); } }
    finally { if (valid(g)) { setBusy(false); lock.current = false; controller.current = null; } }
  };
  if (!data) return failed ? <div className="vx-ops" lang={locale} dir={locale === 'fa' ? 'rtl' : 'ltr'}>
    <Banner tone="danger" action={<button type="button" className="vx-btn vx-btn-secondary vx-btn-xs" disabled={busy} onClick={() => void load(cursor.current)}>{c.operatorRefresh}</button>}>{c.error}</Banner>
  </div> : null;
  const disabled = busy || unknown || data.policyStatus !== 'available';
  const confirmBox = (text: string, action: () => void, label: string, off: boolean) => <div className="vx-you-confirm" role="group" aria-label={text}>
    <p className="vx-small">{text}</p>
    <div className="vx-dock-row">
      <button type="button" className="vx-btn vx-btn-secondary vx-btn-sm" disabled={busy} onClick={() => { setClosing(null); setPurging(null); }}>{c.cancel}</button>
      <button type="button" className="vx-btn vx-btn-danger vx-btn-sm" disabled={off} onClick={() => { haptic.warn(); action(); }}>{label}</button>
    </div>
  </div>;
  return <section className="vx-section vx-ops" aria-labelledby={`${id}-title`} aria-busy={busy} lang={locale} dir={locale === 'fa' ? 'rtl' : 'ltr'}>
    <div className="vx-section-head">
      <h2 className="vx-over" id={`${id}-title`}>{c.operations}</h2>
      <button type="button" className="vx-icon-btn" disabled={busy} onClick={() => void load(cursor.current)} aria-label={c.operatorRefresh}>{busy ? <Spinner /> : <Icon name="refresh" size={18} />}</button>
    </div>
    <p className="vx-section-foot vx-diag-lede">{c.operatorIntro}</p>
    {unknown && <Banner tone="danger">{c.operatorError}</Banner>}
    {data.policyStatus !== 'available' && <Banner tone="warn"><span role="status">{c.unavailable}</span></Banner>}
    <div className="vx-group">
      {!data.requests.length && <div className="vx-row"><span className="vx-row-sub">{c.empty}</span></div>}
      {data.requests.map(row => <article className="vx-row top vx-ops-item" key={row.requestId} aria-label={`${c.kinds[row.kind]} · ${row.requestId}`}>
        <span className="vx-row-main">
          <span className="vx-ops-title"><span className="vx-row-title">{c.kinds[row.kind]}</span><span className="vx-pill">{c[row.space]}</span></span>
          <span className="vx-row-sub vx-ops-state" role="status">{rightsState(row, locale)}</span>
          <span className="vx-ops-refs">
            <span className="vx-row-sub">{c.reference}</span><code className="vx-ref"><bdi>{row.requestId}</bdi></code>
            <code className="vx-ref"><bdi>{row.accountRef}</bdi></code>
          </span>
          <span className="vx-row-sub">{c.receivedAt}: {rightsDate(row.createdAt, locale)} · {c.updatedAt}: {rightsDate(row.updatedAt, locale)}</span>
          <span className="vx-row-sub">{row.deadline.state === 'scheduled' ? `${c.deadline}: ${rightsDate(row.deadline.dueAt, locale)}` : c.unresolved}</span>
          <span className="vx-row-sub vx-3">{c.coverage}</span>
          {row.retentionReviewRequired && <span className="vx-row-sub warn">{c.retention}</span>}
          {row.retentionAt !== undefined && <span className="vx-row-sub">{c.retentionAt}: {rightsDate(row.retentionAt, locale)}</span>}
          {!!row.retentionActions?.length && <span className="vx-ops-retention">
            <span className="vx-row-sub">{c.retentionScope}</span>
            <span className="vx-ops-actions">
              <button type="button" className="vx-btn vx-btn-xs" disabled={busy || unknown} onClick={() => void run(row, 'reassess_retention')}>{c.reassess}</button>
              {row.retentionActions.includes('purge_terminal_record') && purging !== row.requestId && <button type="button" className="vx-btn vx-btn-ghost vx-btn-xs vx-danger-text" disabled={busy || unknown} onClick={() => setPurging(row.requestId)}>{c.purge}</button>}
            </span>
            {purging === row.requestId && confirmBox(c.confirmPurge, () => void run(row, 'purge_terminal_record'), c.purge, busy || unknown)}
          </span>}
          <span className="vx-ops-actions">
            {row.state === 'received' && <button type="button" className="vx-btn vx-btn-tonal vx-btn-xs" disabled={disabled} onClick={() => void run(row, 'begin_review', 'review_pending')}>{c.begin}</button>}
            {['received', 'operator_review', 'operator_action_pending'].includes(row.state) && <button type="button" className="vx-btn vx-btn-xs" disabled={disabled} onClick={() => void run(row, 'request_requester_action', 'requester_action_required')}>{c.ask}</button>}
            {['received', 'operator_review', 'awaiting_requester'].includes(row.state) && <button type="button" className="vx-btn vx-btn-xs" disabled={disabled} onClick={() => void run(row, 'mark_operator_pending', 'review_pending')}>{c.mark}</button>}
            {row.state !== 'closed_unfulfilled' && closing !== row.requestId && <button type="button" className="vx-btn vx-btn-ghost vx-btn-xs vx-danger-text" disabled={disabled} onClick={() => setClosing(row.requestId)}>{c.operatorClose}</button>}
          </span>
          {closing === row.requestId && confirmBox(c.confirmClose, () => void run(row, 'close_unfulfilled', 'outside_supported_scope'), c.close, disabled)}
        </span>
      </article>)}
    </div>
    {(cursor.current || data.nextCursor) && <div className="vx-ops-pages">
      {cursor.current && <button type="button" className="vx-btn vx-btn-ghost vx-btn-xs" disabled={busy} onClick={() => void load()}>{c.first}</button>}
      {data.nextCursor && <button type="button" className="vx-btn vx-btn-secondary vx-btn-xs" disabled={busy} onClick={() => void load(data.nextCursor)}>{c.more}</button>}
    </div>}
  </section>;
}
