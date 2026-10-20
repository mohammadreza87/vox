'use client';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { rightsApi, type LocalUseView, type LocalUseScope, type RightsRequestView } from '../_lib/rights-client';
import { localUseNotice } from '@/lib/adaptive/rights-intake/local-use-notice';
import { rightsDate, type RightsLocale } from '../_lib/rights-copy';
import { tg } from '../_lib/client';

export function LocalUseState({ view, locale, historical = false }: { view: LocalUseView; locale: RightsLocale; historical?: boolean }) {
  const c = localUseNotice[locale], s = view.status;
  const text = s.technical.current === 'active' ? c.active : s.technical.current === 'released' ? s.effectiveBlocked ? c.otherHold : c.released : s.technical.current === 'not_applied' ? c.notApplied : c.unavailable;
  return <div className="vx-small" role="status">
    {historical && <strong>{c.lastConfirmed}: </strong>}{text}
    {s.technical.current === 'active' && s.technical.reconciliation === 'pending' && <p>{c.recording}</p>}
    {s.technical.current === 'active' && s.technical.reconciliation === 'failed' && <p>{c.recordingFailed}</p>}
    {s.observedAt !== null && <p>{historical ? c.lastConfirmed : c.asOf}: {rightsDate(s.observedAt,locale)}</p>}
    {s.reason === 'policy_unavailable' && <p>{c.disabled}</p>}
  </div>;
}
/** Mounted below an existing own request. No intake action silently changes use. */
export function RightsLocalUsePanel({ row, locale, session }: { row: RightsRequestView; locale: RightsLocale; session: string }) {
  const [purpose,setPurpose] = useState<LocalUseScope['purpose']>('optional.personalization');
  return <LocalUsePanel key={JSON.stringify([session,row.requestId,row.revision,row.space,purpose])} row={row} locale={locale} session={session} purpose={purpose} onPurpose={setPurpose} />;
}
function LocalUsePanel({ row, locale, session, purpose, onPurpose }: { row: RightsRequestView; locale: RightsLocale; session: string; purpose: LocalUseScope['purpose']; onPurpose: (value: LocalUseScope['purpose'])=>void }) {
  const c = localUseNotice[locale], id = useId(), scope = {space:row.space,purpose};
  const [hydrated,setHydrated] = useState(false), [view,setView] = useState<LocalUseView|null>(null), [last,setLast] = useState<LocalUseView|null>(null), [busy,setBusy] = useState(true), [issue,setIssue] = useState<''|'unknown'|'unavailable'>(''), [mutation,setMutation] = useState(false);
  const alive = useRef(false), generation = useRef(0), lock = useRef(false), controller = useRef<AbortController|null>(null);
  const valid = useCallback((g:number) => alive.current && generation.current === g && tg()?.initData === session,[session]);
  const load = useCallback(async () => {
    if (lock.current) return; lock.current = true; const g = ++generation.current, abort = new AbortController(); controller.current = abort;
    setBusy(true);setMutation(false);setIssue('');setView(null);
    try { const value = await rightsApi.localUse(row.requestId,{space:row.space,purpose},session,abort.signal); if (valid(g)) {setView(value);if(value.status.technical.current !== 'unknown')setLast(value);} }
    catch { if (valid(g)) setIssue('unavailable'); }
    finally { if(valid(g)) {setBusy(false);lock.current=false;controller.current=null;} }
  },[row.requestId,row.space,purpose,session,valid]);
  const dispose=useCallback(()=>{alive.current=false;generation.current++;controller.current?.abort();controller.current=null;lock.current=false;},[]);
  useEffect(() => {alive.current=true;setHydrated(true);void load();return dispose;},[load,dispose]);
  const run = async (action:'apply'|'release') => {
    if (!hydrated || lock.current || issue || !view?.availableActions.includes(action) || tg()?.initData !== session) return;
    const g=++generation.current, abort=new AbortController();controller.current=abort;lock.current=true;
    setBusy(true);setMutation(true);setIssue('');setView(null); let sent=false;
    try {
      const plan = await rightsApi.localUsePlan(row.requestId,row.space,{version:1,action,purpose,locale,...(action==='release' && view.status.selectedEffectId ? {effectId:view.status.selectedEffectId} : {})},session,abort.signal);
      if (!valid(g)) return;
      sent=true;
      const value = await rightsApi.localUseAction(row.requestId,scope,{version:1,eventId:crypto.randomUUID(),action,planHandle:plan.planHandle},session,abort.signal);
      if (valid(g)) { const current:LocalUseView={version:1,status:value.status,availableActions:value.availableActions};setView(current);setLast(current); }
    } catch { if (valid(g)) setIssue(sent?'unknown':'unavailable'); }
    finally { if(valid(g)) {setBusy(false);setMutation(false);lock.current=false;controller.current=null;} }
  };
  return <section className="vx-card" lang={locale} dir={locale==='fa'?'rtl':'ltr'} aria-labelledby={`${id}-title`} aria-busy={busy} style={{minWidth:0,overflowWrap:'anywhere'}}>
    <h4 className="vx-head" id={`${id}-title`}>{c.title} · {c[row.space]}</h4>
    <label htmlFor={`${id}-purpose`}>{c.purpose}</label>
    <select id={`${id}-purpose`} className="vx-input" value={purpose} disabled={!hydrated || busy} onChange={e=>onPurpose(e.target.value as LocalUseScope['purpose'])}>
      <option value="optional.personalization">{c.personalization}</option><option value="optional.product_analytics">{c.analytics}</option>
    </select>
    <p className="vx-small">{c.decision}</p><p className="vx-small">{purpose==='optional.personalization'?c.personalizationScope:c.analyticsScope}</p><p className="vx-small">{c.exceptions}</p><p className="vx-small">{c.legal}</p>
    {busy && <p role="status">{mutation?c.pending:c.loading}</p>}
    {issue && <p role="alert">{c[issue]}</p>}
    {view && <LocalUseState view={view} locale={locale}/>}
    {(!view || view.status.technical.current === 'unknown') && last && <LocalUseState view={last} locale={locale} historical/>}
    <div className="vx-privacy-actions" style={{flexWrap:'wrap'}}>
      {view?.availableActions.includes('apply') && <button className="vx-btn vx-btn-secondary" disabled={!hydrated||busy||!!issue} onClick={()=>void run('apply')}>{c.apply}</button>}
      <button className="vx-btn vx-btn-secondary" disabled={!hydrated||busy} onClick={()=>void load()}>{c.refresh}</button>
    </div>
    {view?.availableActions.includes('release') && <div><p className="vx-small">{c.releaseDecision}</p><button className="vx-btn vx-btn-secondary" disabled={!hydrated||busy||!!issue} onClick={()=>void run('release')}>{c.release}</button></div>}
  </section>;
}
