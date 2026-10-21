'use client';
import { useCallback, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { rightsApi, type RightsRequestView, type RightsSnapshot, type RightsSpace } from '../_lib/rights-client';
import { rightsCopy, rightsDate, rightsState, rightsTitle, type RightsLocale } from '../_lib/rights-copy';
import { tg } from '../_lib/client';
import { Icon, Picker, Row, Seg, Spinner } from './ui';

type Kind = RightsRequestView['kind'];

/**
 * A remount boundary drops all prior account/space metadata before the next fetch.
 * `dock`: the host Sheet's dock element; the volt Submit renders there (UI §4.15), else at the end of the panel.
 */
export function RightsRequestPanel({ space, locale = 'en', sessionKey = tg()?.initData ?? '', dock }: { space: RightsSpace; locale?: RightsLocale; sessionKey?: string; dock?: HTMLElement | null }) {
  return <RequestPanel key={JSON.stringify([sessionKey, space])} space={space} locale={locale} session={sessionKey} dock={dock ?? null} />;
}
function RequestPanel({ space, locale, session, dock }: { space: RightsSpace; locale: RightsLocale; session: string; dock: HTMLElement | null }) {
  const c = rightsCopy[locale], id = useId();
  const [data, setData] = useState<RightsSnapshot | null>(null), [busy, setBusy] = useState(true), [issue, setIssue] = useState<'' | 'unknown' | 'error'>(''), [notice, setNotice] = useState('');
  const [kind, setKind] = useState<Kind>('access_export'), [closing, setClosing] = useState<string | null>(null), [picking, setPicking] = useState(false);
  const controller = useRef<AbortController | null>(null), generation = useRef(0), lock = useRef(true), alive = useRef(true);
  const valid = useCallback((g: number) => alive.current && generation.current === g && tg()?.initData === session, [session]);
  const load = useCallback(async () => {
    if (lock.current && controller.current) return;
    const g = ++generation.current, abort = new AbortController(); controller.current = abort; lock.current = true;
    setBusy(true); setIssue(''); setNotice(''); setClosing(null); setData(null);
    try { const value = await rightsApi.read(space, session, abort.signal); if (valid(g)) { setData(value); setKind(current => value.supportedKinds.includes(current) ? current : value.supportedKinds[0] ?? 'access_export'); } }
    catch { if (valid(g)) setIssue('error'); }
    finally { if (valid(g)) { lock.current = false; setBusy(false); controller.current = null; } }
  }, [space, session, valid]);
  const dispose = useCallback(() => { alive.current = false; controller.current?.abort(); controller.current = null; lock.current = false; }, []);
  useLayoutEffect(() => { alive.current = true; void load(); return dispose; }, [load, dispose]);
  const run = async (row?: RightsRequestView, action?: 'prepare_local_export' | 'withdraw_request') => {
    if (lock.current || !data?.available || !data.supportedKinds.includes(kind) || issue || tg()?.initData !== session) return;
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
  const disabled = busy || !!issue || !data?.available || !data.supportedKinds.includes(kind);
  const kinds = data?.supportedKinds ?? [];
  // Request type (UI §5.5): one kind reads as a value, two or three are a segmented control, more open a picker.
  const kindControl = !kinds.length ? null
    : kinds.length === 1 ? <div className="vx-group"><Row title={c.kind} plain value={c.kinds[kinds[0]]} /></div>
    : kinds.length <= 3 ? <div className="vx-field"><span className="vx-label" aria-hidden="true">{c.kind}</span>
        <Seg label={c.kind} value={kind} disabled={disabled} onChange={setKind} options={kinds.map(value => ({ value, label: c.kinds[value] }))} /></div>
    : <>
        <div className="vx-group"><Row title={c.kind} plain value={c.kinds[kind]} chevron disabled={disabled} aria-haspopup="dialog" onClick={() => setPicking(true)} /></div>
        <Picker open={picking} onClose={() => setPicking(false)} title={c.kind} value={kind} onChange={setKind} options={kinds.map(value => ({ value, label: c.kinds[value] }))} />
      </>;
  const submit = <button type="button" className="vx-btn vx-btn-primary" disabled={disabled} onClick={() => void run()}>{c.submit}</button>;
  return <section className="vx-sheet-stack vx-rights" dir={locale === 'fa' ? 'rtl' : 'ltr'} lang={locale} aria-labelledby={`${id}-title`} aria-busy={busy}>
    <div className="vx-sheet-head">
      <h2 className="vx-title-m" id={`${id}-title`}>{rightsTitle(space, locale)}</h2>
      <p className="vx-small vx-2">{c.scope}</p>
    </div>
    <div className="vx-rights-prose"><p>{c.intro}</p><p className="vx-2">{c.immediate}</p></div>
    {busy && <p className="vx-rights-note" role="status"><Spinner size={14} /> {data ? c.pending : c.loading}</p>}
    {issue && <div className="vx-banner warn"><Icon name="warn" size={18} /><div className="vx-banner-body"><span role="alert">{c[issue]}</span>
      <button type="button" className="vx-btn vx-btn-secondary vx-btn-xs" disabled={busy} onClick={() => void load()}>{c.refresh}</button></div></div>}
    {data && (!data.available || data.policyStatus !== 'available') && <p className="vx-rights-note" role="status">{c.unavailable}</p>}
    {notice === 'prepared' && <div className="vx-banner info"><Icon name="check" size={18} /><div className="vx-banner-body"><span role="status">{c.prepared}</span></div></div>}
    {kindControl}
    {dock ? createPortal(submit, dock) : <div className="vx-dock-row">{submit}</div>}
    <p className="vx-footnote">{c.support}: <a href="mailto:info@joyixir.com" dir="ltr">info@joyixir.com</a></p>
    {data && !data.requests.length && <p className="vx-footnote">{c.empty}</p>}
    {data?.expiredRequests?.map(row => <p key={row.requestId} className="vx-footnote" role="status">{c.reference}: <bdi>{row.requestId}</bdi> · {c.expiredRecord} {rightsDate(row.retainUntil, locale)}</p>)}
    {!!data?.requests.length && <div className="vx-group">{data.requests.map(row => <article className="vx-row top vx-rights-row" key={row.requestId} aria-label={`${c.kinds[row.kind]} · ${row.requestId}`}>
      <span className="vx-row-main">
        <span className="vx-row-title">{c.kinds[row.kind]} · {c[row.space]}</span>
        <span className="vx-row-sub" role="status">{rightsState(row, locale)}</span>
        <span className="vx-row-sub">{c.reference}: <bdi className="vx-rights-ref">{row.requestId}</bdi></span>
        <span className="vx-row-sub">{c.receivedAt}: {rightsDate(row.createdAt, locale)} · {c.updatedAt}: {rightsDate(row.updatedAt, locale)}</span>
        <span className="vx-row-sub">{row.deadline.state === 'scheduled' ? `${c.deadline}: ${rightsDate(row.deadline.dueAt, locale)}` : c.unresolved}</span>
        <span className="vx-footnote">{c.coverage}</span>
        {row.retentionReviewRequired && <span className="vx-row-sub" role="status">{c.retention}</span>}
        {row.state !== 'closed_unfulfilled' && <span className="vx-rights-actions">
          {row.kind === 'access_export' && <button className="vx-btn vx-btn-secondary vx-btn-xs" disabled={disabled} onClick={() => void run(row, 'prepare_local_export')}><Icon name="download" size={14} />{c.prepare}</button>}
          {closing !== row.requestId && <button className="vx-btn vx-btn-ghost vx-btn-xs" disabled={disabled} onClick={() => setClosing(row.requestId)}>{c.withdraw}</button>}
        </span>}
        {row.state !== 'closed_unfulfilled' && closing === row.requestId && <span className="vx-you-confirm">
          <span>{c.confirmClose}</span>
          <span className="vx-dock-row"><button className="vx-btn vx-btn-secondary vx-btn-sm" disabled={busy} onClick={() => setClosing(null)}>{c.cancel}</button>
            <button className="vx-btn vx-btn-danger vx-btn-sm" disabled={disabled} onClick={() => void run(row, 'withdraw_request')}>{c.close}</button></span>
        </span>}
      </span>
    </article>)}</div>}
  </section>;
}
