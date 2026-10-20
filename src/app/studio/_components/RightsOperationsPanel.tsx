'use client';
import { useCallback, useId, useLayoutEffect, useRef, useState } from 'react';
import { rightsApi, RightsClientError, type RightsOperationView, type RightsOperations } from '../_lib/rights-client';
import { rightsCopy, rightsDate, rightsState, type RightsLocale } from '../_lib/rights-copy';
import { tg } from '../_lib/client';
import type { OperatorAction } from '@/lib/adaptive/rights-intake/contracts';

/** A product role merely permits checking the separate server privacy-operator gate. */
export function RightsOperationsPanel({ locale = 'en', sessionKey = tg()?.initData ?? '' }: { locale?: RightsLocale; sessionKey?: string }) {
  return <OperationsPanel key={sessionKey} locale={locale} session={sessionKey} />;
}
function OperationsPanel({ locale, session }: { locale: RightsLocale; session: string }) {
  const c = rightsCopy[locale], id = useId();
  const [data, setData] = useState<RightsOperations | null>(null), [busy, setBusy] = useState(true), [unknown, setUnknown] = useState(false), [closing, setClosing] = useState<string | null>(null), [failed, setFailed] = useState(false);
  const cursor = useRef<string | undefined>(undefined), controller = useRef<AbortController | null>(null), alive = useRef(true), generation = useRef(0), lock = useRef(false);
  const valid = useCallback((g: number) => alive.current && generation.current === g && tg()?.initData === session, [session]);
  const load = useCallback(async (next?: string) => {
    if (lock.current) return;
    const g = ++generation.current, abort = new AbortController(); controller.current = abort; lock.current = true;
    cursor.current = next; setBusy(true); setUnknown(false); setFailed(false); setClosing(null); setData(null);
    try { const value = await rightsApi.operations(session, next, abort.signal); if (valid(g)) setData(value); }
    catch (error) { if (valid(g) && !(error instanceof RightsClientError && [401, 403].includes(error.status))) setFailed(true); }
    finally { if (valid(g)) { setBusy(false); lock.current = false; controller.current = null; } }
  }, [session, valid]);
  const dispose = useCallback(() => { alive.current = false; controller.current?.abort(); controller.current = null; lock.current = false; }, []);
  useLayoutEffect(() => { alive.current = true; void load(); return dispose; }, [load, dispose]);
  const run = async (row: RightsOperationView, action: OperatorAction['action'], reasonCode: OperatorAction['reasonCode']) => {
    if (lock.current || unknown || data?.policyStatus !== 'available') return;
    const g = ++generation.current, abort = new AbortController(); controller.current = abort; lock.current = true; setBusy(true); setClosing(null);
    try {
      await rightsApi.operate(row.requestId, { version: 1, eventId: crypto.randomUUID(), expectedRevision: row.revision, action, reasonCode, operationHandle: row.operationHandle }, session, abort.signal);
      if (!valid(g)) return;
      // Refresh current handles/authority; never rebase or replay an old mutation automatically.
      setData(null);
      const value = await rightsApi.operations(session, cursor.current, abort.signal); if (valid(g)) setData(value);
    } catch (error) { if (valid(g)) { if (error instanceof RightsClientError && [401, 403].includes(error.status)) setData(null); else setUnknown(true); } }
    finally { if (valid(g)) { setBusy(false); lock.current = false; controller.current = null; } }
  };
  if (!data) return failed ? <div lang={locale} dir={locale === 'fa' ? 'rtl' : 'ltr'}><p role="alert">{c.error}</p><button className="vx-btn vx-btn-secondary" disabled={busy} onClick={() => void load(cursor.current)}>{c.operatorRefresh}</button></div> : null;
  const disabled = busy || unknown || data.policyStatus !== 'available';
  return <section className="vx-card vx-privacy-card" aria-labelledby={`${id}-title`} aria-busy={busy} lang={locale} dir={locale === 'fa' ? 'rtl' : 'ltr'} style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
    <h2 className="vx-head" id={`${id}-title`}>{c.operations}</h2><p className="vx-small vx-2">{c.operatorIntro}</p>
    {busy && <p role="status">{c.pending}</p>}{unknown && <p role="alert">{c.operatorError}</p>}{data.policyStatus !== 'available' && <p role="status">{c.unavailable}</p>}
    {!data.requests.length && <p>{c.empty}</p>}
    {data.requests.map(row => <article className="vx-card" key={row.requestId} aria-label={`${c.kinds[row.kind]} · ${row.requestId}`}>
      <h3 className="vx-head">{c.kinds[row.kind]} · {c[row.space]}</h3><p className="vx-small">{c.reference}: <bdi>{row.requestId}</bdi></p><p className="vx-small"><bdi>{row.accountRef}</bdi></p>
      <p className="vx-small" role="status">{rightsState(row, locale)}</p><p className="vx-small">{c.receivedAt}: {rightsDate(row.createdAt, locale)} · {c.updatedAt}: {rightsDate(row.updatedAt, locale)}</p>
      <p className="vx-small">{row.deadline.state === 'scheduled' ? `${c.deadline}: ${rightsDate(row.deadline.dueAt, locale)}` : c.unresolved}</p><p className="vx-small vx-2">{c.coverage}</p>{row.retentionReviewRequired && <p>{c.retention}</p>}
      <div className="vx-privacy-actions" style={{ flexWrap: 'wrap' }}>
        {row.state === 'received' && <button className="vx-btn vx-btn-secondary" disabled={disabled} onClick={() => void run(row, 'begin_review', 'review_pending')}>{c.begin}</button>}
        {['received', 'operator_review', 'operator_action_pending'].includes(row.state) && <button className="vx-btn vx-btn-secondary" disabled={disabled} onClick={() => void run(row, 'request_requester_action', 'requester_action_required')}>{c.ask}</button>}
        {['received', 'operator_review', 'awaiting_requester'].includes(row.state) && <button className="vx-btn vx-btn-secondary" disabled={disabled} onClick={() => void run(row, 'mark_operator_pending', 'review_pending')}>{c.mark}</button>}
        {row.state !== 'closed_unfulfilled' && (closing === row.requestId ? <div><p>{c.confirmClose}</p><button className="vx-btn vx-btn-danger" disabled={disabled} onClick={() => void run(row, 'close_unfulfilled', 'outside_supported_scope')}>{c.close}</button><button className="vx-btn vx-btn-secondary" disabled={busy} onClick={() => setClosing(null)}>{c.cancel}</button></div> : <button className="vx-btn vx-btn-secondary" disabled={disabled} onClick={() => setClosing(row.requestId)}>{c.operatorClose}</button>)}
      </div>
    </article>)}
    <div className="vx-privacy-actions" style={{ flexWrap: 'wrap' }}><button className="vx-btn vx-btn-secondary" disabled={busy} onClick={() => void load(cursor.current)}>{c.operatorRefresh}</button>{cursor.current && <button className="vx-btn vx-btn-secondary" disabled={busy} onClick={() => void load()}>{c.first}</button>}{data.nextCursor && <button className="vx-btn vx-btn-secondary" disabled={busy} onClick={() => void load(data.nextCursor)}>{c.more}</button>}</div>
  </section>;
}
