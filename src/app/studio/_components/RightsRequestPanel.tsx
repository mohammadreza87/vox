'use client';
import { useCallback, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { rightsApi, type RightsRequestView, type RightsSnapshot, type RightsSpace } from '../_lib/rights-client';
import { rightsCopy, rightsDate, rightsState, rightsTitle, type RightsLocale } from '../_lib/rights-copy';
import { RightsLocalUsePanel } from './RightsLocalUsePanel';
import { RightsErasurePanel } from './RightsErasurePanel';
import type { AdaptiveSnapshot } from '../_lib/adaptive-client';
type ErasureProps = { memorySnapshot?: AdaptiveSnapshot | null; notesStale?: boolean; mutationDisabled?: boolean; onRefreshNotes?: () => void; onErasurePendingChange?: (token: string, pending: boolean) => boolean; onErasureDispatched?: () => void };
import { tg } from '../_lib/client';
import { Icon, Picker, Row, Seg, Spinner } from './ui';

type Kind = RightsRequestView['kind'];
/** A remount boundary drops prior account/space metadata before the next fetch. */
export function RightsRequestPanel({ space, locale = 'en', sessionKey = tg()?.initData ?? '', dock, ...erasure }: { space: RightsSpace; locale?: RightsLocale; sessionKey?: string; dock?: HTMLElement | null } & ErasureProps) {
  return <RequestPanel key={JSON.stringify([sessionKey, space])} space={space} locale={locale} session={sessionKey} dock={dock ?? null} {...erasure} />;
}
function RequestPanel({ space, locale, session, dock, ...erasure }: { space: RightsSpace; locale: RightsLocale; session: string; dock: HTMLElement | null } & ErasureProps) {
  const c = rightsCopy[locale], id = useId();
  const [data, setData] = useState<RightsSnapshot | null>(null), [busy, setBusy] = useState(true), [issue, setIssue] = useState<'' | 'unknown' | 'error'>(''), [notice, setNotice] = useState('');
  const [kind, setKind] = useState<Kind>('access_export'), [closing, setClosing] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const controller = useRef<AbortController | null>(null), generation = useRef(0), lock = useRef(true), alive = useRef(true);
  const valid = useCallback((g: number) => alive.current && generation.current === g && tg()?.initData === session, [session]);
  const load = useCallback(async () => {
    if (lock.current && controller.current) return;
    const g = ++generation.current, abort = new AbortController(); controller.current = abort; lock.current = true;
    setBusy(true); setIssue(''); setNotice(''); setClosing(null); setPicking(false); setData(null);
    try { const value = await rightsApi.read(space, session, abort.signal); if (valid(g)) { setData(value); setKind(current => value.supportedKinds.includes(current) ? current : value.supportedKinds[0] ?? 'access_export'); } }
    catch { if (valid(g)) setIssue('error'); }
    finally { if (valid(g)) { lock.current = false; setBusy(false); controller.current = null; } }
  }, [space, session, valid]);
  const dispose = useCallback(() => { alive.current = false; controller.current?.abort(); controller.current = null; lock.current = false; }, []);
  useLayoutEffect(() => { alive.current = true; void load(); return dispose; }, [load, dispose]);
  const run = async (row?: RightsRequestView, action?: 'prepare_local_export' | 'withdraw_request') => {
    if (lock.current || erasure.mutationDisabled || !data?.available || !data.supportedKinds.includes(kind) || issue || tg()?.initData !== session) return;
    const g = ++generation.current, abort = new AbortController(); controller.current = abort; lock.current = true;
    setBusy(true); setIssue(''); setNotice(''); setClosing(null);
    try {
      const eventId = crypto.randomUUID();
      if (row && action) {
        let result: Awaited<ReturnType<typeof rightsApi.act>> | null = await rightsApi.act(row, { version: 1, eventId, expectedRevision: row.revision, action }, session, abort.signal);
        if (!valid(g)) return;
        if (result.type === 'export') {
          const blob = new Blob([JSON.stringify(result.value, null, 2)], { type: 'application/json' });
          const url = URL.createObjectURL(blob), link = document.createElement('a');
          try { link.href = url; link.download = `vox-local-account-${space}.json`; document.body.appendChild(link); link.click(); }
          finally { link.remove(); URL.revokeObjectURL(url); }
          result = null; // Drop export bytes before waiting for a metadata refresh.
          setNotice('prepared');
          const value = await rightsApi.read(space, session, abort.signal); if (valid(g)) { setData(value); setKind(current => value.supportedKinds.includes(current) ? current : value.supportedKinds[0] ?? 'access_export'); }
        } else {
          const value = result.value;
          setData(current => current && ({ ...current, available: current.available && value.policyStatus === 'available', policyStatus: value.policyStatus, supportedKinds: value.policyStatus === 'available' ? current.supportedKinds : [], requests: current.requests.map(item => item.requestId === value.request.requestId ? value.request : item) }));
        }
      } else if (data.intakePolicy) {
        const result = await rightsApi.create({ version: 1, eventId, space, kind, locale, expectedIntakePolicyRevision: data.intakePolicy.revision }, session, abort.signal);
        if (!valid(g)) return;
        setData(current => current && ({ ...current, available: current.available && result.policyStatus === 'available', policyStatus: result.policyStatus, supportedKinds: result.policyStatus === 'available' ? current.supportedKinds : [], requests: [...current.requests.filter(item => item.requestId !== result.request.requestId), result.request] }));
      }
    } catch { if (valid(g)) setIssue('unknown'); }
    finally { if (valid(g)) { lock.current = false; setBusy(false); controller.current = null; } }
  };
  const disabled = busy || !!erasure.mutationDisabled || !!issue || !data?.available || !data.supportedKinds.includes(kind);
  const kinds = data?.supportedKinds ?? [];
  const kindControl = !kinds.length ? null
    : kinds.length === 1 ? <div className="vx-group"><Row title={c.kind} plain value={c.kinds[kinds[0]]} /></div>
    : kinds.length <= 3 ? <div className="vx-field"><span className="vx-label" aria-hidden="true">{c.kind}</span>
      <Seg label={c.kind} value={kind} disabled={disabled} onChange={setKind} options={kinds.map(value => ({ value, label: c.kinds[value] }))} /></div>
    : <>
      <div className="vx-group"><Row title={c.kind} plain value={c.kinds[kind]} chevron disabled={disabled} aria-haspopup="dialog" onClick={() => setPicking(true)} /></div>
      <Picker open={picking && !disabled} onClose={() => setPicking(false)} title={c.kind} value={kind} onChange={value => { if (!disabled) setKind(value); }} options={kinds.map(value => ({ value, label: c.kinds[value] }))} />
    </>;
  return <section className="vx-card vx-privacy-card" dir={locale === 'fa' ? 'rtl' : 'ltr'} lang={locale} aria-labelledby={`${id}-title`} aria-busy={busy} style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
    <h2 className="vx-head" id={`${id}-title`}>{rightsTitle(space, locale)}</h2>
    <p className="vx-small">{c.scope}</p><p className="vx-small">{c.intro}</p><p className="vx-small vx-2">{c.immediate}</p>
    {busy && <p role="status"><Spinner size={14} />{data ? c.pending : c.loading}</p>}
    {issue && <div className="vx-banner warn"><Icon name="warn" size={18} /><div className="vx-banner-body"><span role="alert">{c[issue]}</span>
      <button type="button" className="vx-btn vx-btn-secondary vx-btn-xs" disabled={busy || !!erasure.mutationDisabled} onClick={() => void load()}>{c.refresh}</button></div></div>}
    {data && (!data.available || data.policyStatus !== 'available') && <p role="status">{c.unavailable}</p>}
    {notice === 'prepared' && <p role="status">{c.prepared}</p>}
    <p className="vx-small vx-2">{c.support}: <a href="mailto:info@joyixir.com" dir="ltr" style={{ color: 'var(--text-2)' }}>info@joyixir.com</a></p>
    {kindControl}
    {dock ? createPortal(<button className="vx-btn vx-btn-primary vx-btn-block" disabled={disabled} onClick={() => void run()}>{c.submit}</button>, dock) : <button className="vx-btn vx-btn-primary" disabled={disabled} onClick={() => void run()}>{c.submit}</button>}
    {data && !data.requests.length && <p className="vx-small">{c.empty}</p>}
    {data?.expiredRequests?.map(row => <p key={row.requestId} className="vx-small" role="status">{c.reference}: <bdi>{row.requestId}</bdi> · {c.expiredRecord} {rightsDate(row.retainUntil, locale)}</p>)}
    {data?.requests.map(row => <article className="vx-card" key={row.requestId} style={{ minWidth: 0, overflowWrap: 'anywhere' }} aria-label={`${c.kinds[row.kind]} · ${row.requestId}`}>
      <h3 className="vx-head">{c.kinds[row.kind]} · {c[row.space]}</h3>
      <p className="vx-small">{c.reference}: <bdi>{row.requestId}</bdi></p>
      <p role="status" className="vx-small">{rightsState(row, locale)}</p>
      <p className="vx-small vx-2">{c.receivedAt}: {rightsDate(row.createdAt, locale)} · {c.updatedAt}: {rightsDate(row.updatedAt, locale)}</p>
      <p className="vx-small">{row.deadline.state === 'scheduled' ? `${c.deadline}: ${rightsDate(row.deadline.dueAt, locale)}` : c.unresolved}</p>
      <p className="vx-small vx-2">{c.coverage}</p>
      {row.kind === 'erasure' && row.state !== 'closed_unfulfilled' && <RightsErasurePanel row={row} locale={locale} session={session} snapshot={erasure.memorySnapshot} notesStale={erasure.notesStale} disabled={busy || !!erasure.mutationDisabled} onRefreshNotes={erasure.onRefreshNotes} onPendingChange={erasure.onErasurePendingChange} onDispatched={erasure.onErasureDispatched} />}
      {['restriction','objection'].includes(row.kind) && <fieldset disabled={!!erasure.mutationDisabled} style={{border:0,padding:0,margin:0,minWidth:0}}><RightsLocalUsePanel row={row} locale={locale} session={session}/></fieldset>}
      {row.retentionReviewRequired && <p role="status">{c.retention}</p>}
      {row.state !== 'closed_unfulfilled' && <div className="vx-privacy-actions" style={{ flexWrap: 'wrap' }}>
        {row.kind === 'access_export' && <button className="vx-btn vx-btn-secondary" disabled={disabled} onClick={() => void run(row, 'prepare_local_export')}>{c.prepare}</button>}
        {closing !== row.requestId && <button className="vx-btn vx-btn-secondary" disabled={disabled} onClick={() => setClosing(row.requestId)}>{c.withdraw}</button>}
        {closing === row.requestId && <div><p>{c.confirmClose}</p><button className="vx-btn vx-btn-danger" disabled={disabled} onClick={() => void run(row, 'withdraw_request')}>{c.close}</button><button className="vx-btn vx-btn-secondary" disabled={busy} onClick={() => setClosing(null)}>{c.cancel}</button></div>}
      </div>}
    </article>)}
  </section>;
}
