'use client';
import { useCallback, useId, useLayoutEffect, useRef, useState } from 'react';
import { rightsApi, RightsClientError, type RightsOperationView, type RightsOperations } from '../_lib/rights-client';
import { rightsCopy, rightsDate, rightsState, type RightsLocale } from '../_lib/rights-copy';
import { LocalUseState } from './RightsLocalUsePanel';
import { localUseNotice } from '@/lib/adaptive/rights-intake/local-use-notice';
import { tg } from '../_lib/client';
import { rightsErasureCopy, rightsErasureOperatorCopy } from '../_lib/rights-erasure-copy';
import type { OperatorAction, RetentionAction } from '@/lib/adaptive/rights-intake/contracts';

/** A product role merely permits checking the separate server privacy-operator gate. */
export function RightsOperationsPanel({ locale = 'en', sessionKey = tg()?.initData ?? '' }: { locale?: RightsLocale; sessionKey?: string }) {
  return <OperationsPanel key={JSON.stringify([sessionKey, locale])} locale={locale} session={sessionKey} />;
}
function OperationsPanel({ locale, session }: { locale: RightsLocale; session: string }) {
  const c = rightsCopy[locale], ec = rightsErasureOperatorCopy[locale], notice = rightsErasureCopy[locale], id = useId();
  const [erasurePhase, setErasurePhase] = useState<'idle'|'pending'|'unknown'>('idle');
  const erasureUnconfirmed = useRef(false), focusAfter = useRef(false), title = useRef<HTMLHeadingElement>(null), issueHeading = useRef<HTMLParagraphElement>(null);
  const [data, setData] = useState<RightsOperations | null>(null), [busy, setBusy] = useState(true), [unknown, setUnknown] = useState(false), [closing, setClosing] = useState<string | null>(null), [purging, setPurging] = useState<string | null>(null), [failed, setFailed] = useState(false);
  const cursor = useRef<string | undefined>(undefined), controller = useRef<AbortController | null>(null), alive = useRef(true), generation = useRef(0), lock = useRef(false);
  const valid = useCallback((g: number) => alive.current && generation.current === g && tg()?.initData === session, [session]);
  const load = useCallback(async (next?: string) => {
    if (lock.current) return;
    const g = ++generation.current, abort = new AbortController(); controller.current = abort; lock.current = true;
    setErasurePhase(erasureUnconfirmed.current ? 'unknown' : 'idle');
    cursor.current = next; setBusy(true); setUnknown(false); setFailed(false); setClosing(null); setPurging(null); setData(null);
    try { const value = await rightsApi.operations(session, next, abort.signal); if (valid(g)) { setData(value); erasureUnconfirmed.current = false; setErasurePhase('idle'); } }
    catch (error) { if (valid(g)) { if (error instanceof RightsClientError && [401, 403].includes(error.status)) { erasureUnconfirmed.current = false; setErasurePhase('idle'); } else setFailed(true); } }
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
  const reconcile = async (row: RightsOperationView, commandEventId: string) => {
    if (lock.current || unknown || !data || tg()?.initData !== session) return;
    const g = ++generation.current, abort = new AbortController(); controller.current = abort; lock.current = true; setBusy(true);
    try {
      await rightsApi.reconcileLocalUse(row.requestId,{version:1,eventId:crypto.randomUUID(),commandEventId,operationHandle:row.operationHandle},session,abort.signal);
      if (!valid(g)) return;
      setData(null); const value = await rightsApi.operations(session,cursor.current,abort.signal); if (valid(g)) setData(value);
    } catch(error) { if (valid(g)) { if (error instanceof RightsClientError && [401,403].includes(error.status)) setData(null); else setUnknown(true); } }
    finally { if(valid(g)) {setBusy(false);lock.current=false;controller.current=null;} }
  };
  const reconcileErasure = async (row: RightsOperationView, operationRef: string) => {
    const selected = row.localErasures?.find(local => local.view.operationRef === operationRef);
    if (lock.current || unknown || !data || data.policyStatus !== 'available' || row.kind !== 'erasure' || !selected?.reconcileAllowed || tg()?.initData !== session) return;
    const g = ++generation.current, abort = new AbortController(); controller.current = abort; lock.current = true; erasureUnconfirmed.current = true; focusAfter.current = true;
    setBusy(true); setErasurePhase('pending'); setClosing(null); setPurging(null);
    try {
      await rightsApi.reconcilePrivateNoteErasure(row, operationRef, { version: 1, eventId: crypto.randomUUID(), commandEventId: selected.commandEventId, operationHandle: row.operationHandle }, session, abort.signal);
      if (!valid(g)) return;
      setData(null);
      const value = await rightsApi.operations(session, cursor.current, abort.signal);
      if (valid(g)) { setData(value); erasureUnconfirmed.current = false; setErasurePhase('idle'); }
    } catch (error) {
      if (valid(g)) {
        if (error instanceof RightsClientError && [401,403].includes(error.status)) { setData(null); erasureUnconfirmed.current = false; setErasurePhase('idle'); }
        else { setUnknown(true); setErasurePhase('unknown'); }
      }
    } finally { if (valid(g)) { setBusy(false); lock.current = false; controller.current = null; } }
  };
  useLayoutEffect(() => { if (!busy && focusAfter.current) { focusAfter.current = false; if (erasurePhase === 'unknown') issueHeading.current?.focus(); else title.current?.focus(); } }, [busy, erasurePhase, data]);
  if (!data && erasurePhase === 'unknown') return <section lang={locale} dir={locale === 'fa' ? 'rtl' : 'ltr'} aria-busy={busy}><p ref={issueHeading} tabIndex={-1} role="alert">{ec.lost}</p><p className="vx-small">{notice.residual}</p><details className="vx-small"><summary style={{minHeight:44}}>{notice.disclosure}</summary><p>{ec.scope}</p><p>{notice.details}</p></details><button className="vx-btn vx-btn-secondary" style={{minHeight:44}} disabled={busy} onClick={() => void load(cursor.current)}>{ec.refresh}</button></section>;
  if (!data) return failed ? <div lang={locale} dir={locale === 'fa' ? 'rtl' : 'ltr'}><p role="alert">{c.error}</p><button className="vx-btn vx-btn-secondary" disabled={busy} onClick={() => void load(cursor.current)}>{c.operatorRefresh}</button></div> : null;
  const disabled = busy || unknown || data.policyStatus !== 'available';
  return <section className="vx-card vx-privacy-card" aria-labelledby={`${id}-title`} aria-busy={busy} lang={locale} dir={locale === 'fa' ? 'rtl' : 'ltr'} style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
    <h2 ref={title} tabIndex={-1} className="vx-head" id={`${id}-title`}>{c.operations}</h2><p className="vx-small vx-2">{c.operatorIntro}</p>
    {busy && <p role="status">{erasurePhase === 'pending' ? ec.pending : c.pending}</p>}{unknown && <p ref={issueHeading} tabIndex={-1} role="alert">{erasurePhase === 'unknown' ? ec.lost : c.operatorError}</p>}{data.policyStatus !== 'available' && <p role="status">{c.unavailable}</p>}
    {!data.requests.length && <p>{c.empty}</p>}
    {data.requests.map((row, rowIndex) => <article className="vx-card" key={row.requestId} aria-label={`${c.kinds[row.kind]} · ${row.requestId}`}>
      <h3 className="vx-head">{c.kinds[row.kind]} · {c[row.space]}</h3><p className="vx-small">{c.reference}: <bdi>{row.requestId}</bdi></p><p className="vx-small"><bdi>{row.accountRef}</bdi></p>
      <p className="vx-small" role="status">{rightsState(row, locale)}</p><p className="vx-small">{c.receivedAt}: {rightsDate(row.createdAt, locale)} · {c.updatedAt}: {rightsDate(row.updatedAt, locale)}</p>
      <p className="vx-small">{row.deadline.state === 'scheduled' ? `${c.deadline}: ${rightsDate(row.deadline.dueAt, locale)}` : c.unresolved}</p><p className="vx-small vx-2">{c.coverage}</p>{row.retentionReviewRequired && <p>{c.retention}</p>}
      {row.localUses?.map(local => <section className="vx-card" key={local.view.status.scope.purpose}>
        <h4 className="vx-head">{localUseNotice[locale].title} · {local.view.status.scope.purpose === 'optional.personalization' ? localUseNotice[locale].personalization : localUseNotice[locale].analytics}</h4>
        <LocalUseState view={local.view} locale={locale} historical={busy || unknown}/>
        {local.reconcileAllowed && local.commandEventId && <button className="vx-btn vx-btn-secondary" disabled={busy || unknown} onClick={()=>void reconcile(row,local.commandEventId!)}>{localUseNotice[locale].reconcile}</button>}
      </section>)}
      {row.kind === 'erasure' && row.localErasures?.map((local, index) => <section className="vx-card" key={local.view.operationRef} aria-labelledby={`${id}-erasure-${rowIndex}-${index}`} style={{minWidth:0,overflowWrap:'anywhere'}}>
        <h4 className="vx-head" id={`${id}-erasure-${rowIndex}-${index}`}>{ec.heading} {index + 1} · {c[row.space]}</h4>
        <p className="vx-small"><strong>{ec.effect}: </strong>{busy || unknown || local.view.technical === 'unknown' ? ec.unknown : local.view.technical === 'note_content_removed' ? ec.removed : ec.notApplied}</p>
        <p className="vx-small"><strong>{ec.receipt}: </strong>{ec[local.view.recording]}</p>
        {!busy && !unknown && local.view.observedAt !== null && Number.isFinite(new Date(local.view.observedAt).valueOf()) && <p className="vx-small">{ec.checked}: {rightsDate(local.view.observedAt,locale)}</p>}
        <p className="vx-small">{notice.residual}</p><details className="vx-small"><summary style={{minHeight:44}}>{notice.disclosure}</summary><p>{ec.scope}</p><p>{notice.details}</p></details>
        {local.reconcileAllowed === true && <><p className="vx-small">{ec.helper}</p><button className="vx-btn vx-btn-secondary" style={{minHeight:44,maxWidth:'100%',whiteSpace:'normal',overflowWrap:'anywhere'}} aria-label={`${ec.action} · ${ec.heading} ${index + 1} · ${c[row.space]}`} disabled={disabled} onClick={() => void reconcileErasure(row,local.view.operationRef)}>{ec.action}</button></>}
      </section>)}
      {row.retentionAt !== undefined && <p className="vx-small">{c.retentionAt}: {rightsDate(row.retentionAt, locale)}</p>}
      {!!row.retentionActions?.length && <div><p className="vx-small">{c.retentionScope}</p><button className="vx-btn vx-btn-secondary" disabled={busy || unknown} onClick={() => void run(row, 'reassess_retention')}>{c.reassess}</button>{row.retentionActions.includes('purge_terminal_record') && (purging === row.requestId ? <div><p>{c.confirmPurge}</p><button className="vx-btn vx-btn-danger" disabled={busy || unknown} onClick={() => void run(row, 'purge_terminal_record')}>{c.purge}</button><button className="vx-btn vx-btn-secondary" disabled={busy} onClick={() => setPurging(null)}>{c.cancel}</button></div> : <button className="vx-btn vx-btn-secondary" disabled={busy || unknown} onClick={() => setPurging(row.requestId)}>{c.purge}</button>)}</div>}
      <div className="vx-privacy-actions" style={{ flexWrap: 'wrap' }}>
        {row.state === 'received' && <button className="vx-btn vx-btn-secondary" disabled={disabled} onClick={() => void run(row, 'begin_review', 'review_pending')}>{c.begin}</button>}
        {['received', 'operator_review', 'operator_action_pending'].includes(row.state) && <button className="vx-btn vx-btn-secondary" disabled={disabled} onClick={() => void run(row, 'request_requester_action', 'requester_action_required')}>{c.ask}</button>}
        {['received', 'operator_review', 'awaiting_requester'].includes(row.state) && <button className="vx-btn vx-btn-secondary" disabled={disabled} onClick={() => void run(row, 'mark_operator_pending', 'review_pending')}>{c.mark}</button>}
        {row.state !== 'closed_unfulfilled' && (closing === row.requestId ? <div><p>{c.confirmClose}</p><button className="vx-btn vx-btn-danger" disabled={disabled} onClick={() => void run(row, 'close_unfulfilled', 'outside_supported_scope')}>{c.close}</button><button className="vx-btn vx-btn-secondary" disabled={busy} onClick={() => setClosing(null)}>{c.cancel}</button></div> : <button className="vx-btn vx-btn-secondary" disabled={disabled} onClick={() => setClosing(row.requestId)}>{c.operatorClose}</button>)}
      </div>
    </article>)}
    <div className="vx-privacy-actions" style={{ flexWrap: 'wrap' }}><button className="vx-btn vx-btn-secondary" disabled={busy} onClick={() => void load(cursor.current)}>{data.requests.some(row => row.localErasures?.length) ? ec.refresh : c.operatorRefresh}</button>{cursor.current && <button className="vx-btn vx-btn-secondary" disabled={busy} onClick={() => void load()}>{c.first}</button>}{data.nextCursor && <button className="vx-btn vx-btn-secondary" disabled={busy} onClick={() => void load(data.nextCursor)}>{c.more}</button>}</div>
  </section>;
}
