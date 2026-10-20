'use client';
import { useCallback, useEffect, useId, useRef, useState, type Ref } from 'react';
import { rightsApi, type LocalErasurePlan, type LocalErasureView, type RightsRequestView } from '../_lib/rights-client';
import type { AdaptiveSnapshot } from '../_lib/adaptive-client';
import { rightsErasureCopy } from '../_lib/rights-erasure-copy';
import { rightsDate, type RightsLocale } from '../_lib/rights-copy';
import { tg } from '../_lib/client';

type Props = { row: RightsRequestView; locale: RightsLocale; session: string; snapshot?: AdaptiveSnapshot | null; notesStale?: boolean; disabled?: boolean; onRefreshNotes?: () => void; onPendingChange?: (token: string, pending: boolean) => boolean; onDispatched?: () => void };
/** Authority changes destroy drafts; the server GET rehydrates minimized current proof. */
export function RightsErasurePanel(props: Props) {
  const { row, snapshot, locale, session } = props;
  const authority = snapshot?.identity;
  return <ErasurePanel key={JSON.stringify([session, row.requestId, row.revision, row.state, row.space, locale, authority?.accountId, authority?.bindingId, authority?.bindingRevision, authority?.confirmed, authority?.bindingExpiresAt, snapshot?.revision])} {...props} />;
}
export function RightsErasureState({ status, locale, unknownRef }: { status: LocalErasureView['operations'][number]; locale: RightsLocale; unknownRef?: Ref<HTMLParagraphElement> }) {
  const c = rightsErasureCopy[locale];
  return <div className="vx-small">
    <p ref={status.technical === 'unknown' ? unknownRef : undefined} tabIndex={status.technical === 'unknown' ? -1 : undefined} role={status.technical === 'unknown' ? 'alert' : undefined}>{status.technical === 'note_content_removed' ? c.effect : status.technical === 'not_applied' ? c.notApplied : c.unknown}</p>
    {status.recording === 'intent_recorded' && <p>{c.intent}</p>}
    {status.recording === 'acknowledgement_pending' && <p>{status.technical === 'note_content_removed' ? c.pending : c.intent}</p>}
    {status.recording === 'recorded' && <p>{c.recorded}</p>}
    {status.recording === 'failed' && <p>{c.failed}</p>}
    {status.observedAt !== null && Number.isFinite(new Date(status.observedAt).valueOf()) && <p>{c.checked}: {rightsDate(status.observedAt, locale)}</p>}
  </div>;
}
function ErasurePanel({ row, locale, session, snapshot, notesStale, disabled, onRefreshNotes, onPendingChange, onDispatched }: Props) {
  const c = rightsErasureCopy[locale], id = useId();
  const [view, setView] = useState<LocalErasureView | null>(null), [phase, setPhase] = useState<'loading'|'idle'|'selecting'|'planning'|'review'|'submitting'|'current'|'unknown'|'stale'>('loading');
  const [needsNotesRefresh, setNeedsNotesRefresh] = useState(false);
  const [selected, setSelected] = useState<string | null>(null), [plan, setPlan] = useState<LocalErasurePlan | null>(null);
  const alive = useRef(false), generation = useRef(0), lock = useRef(false), dispatched = useRef(false), controller = useRef<AbortController | null>(null), pendingToken = useRef<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null), result = useRef<HTMLHeadingElement>(null), action = useRef<HTMLButtonElement>(null), alert = useRef<HTMLParagraphElement>(null);
  const pendingCallback = useRef(onPendingChange); pendingCallback.current = onPendingChange;
  const valid = useCallback((g: number) => alive.current && generation.current === g && tg()?.initData === session, [session]);
  const release = useCallback(() => { if (pendingToken.current) { pendingCallback.current?.(pendingToken.current, false); pendingToken.current = null; } }, []);
  const clearDraft = () => { setSelected(null); setPlan(null); };
  const load = useCallback(async (manual = false) => {
    if (lock.current) return;
    const g = ++generation.current, abort = new AbortController(); controller.current = abort; lock.current = true;
    setView(null); setSelected(null); setPlan(null); setPhase('loading');
    try { const current = await rightsApi.privateNoteErasure(row, session, abort.signal); if (valid(g)) { setView(current); if (manual && current.operations.some(status => status.technical === 'not_applied')) setNeedsNotesRefresh(true); setPhase('current'); } }
    catch { if (valid(g)) setPhase('unknown'); }
    finally { if (valid(g)) { lock.current = false; controller.current = null; } }
  }, [row, session, valid]);
  const dispose = useCallback(() => { alive.current = false; generation.current++; controller.current?.abort(); controller.current = null; lock.current = false; release(); }, [release]);
  useEffect(() => { alive.current = true; void load(); return dispose; }, [load, dispose]);
  useEffect(() => {
    if (phase !== 'review' || !plan) return;
    const expiry = setTimeout(() => { setSelected(null); setPlan(null); setPhase('stale'); }, Math.max(0, Math.min(plan.expiresAt - Date.now(), 2_147_483_647)));
    return () => clearTimeout(expiry);
  }, [phase, plan]);
  useEffect(() => { if (phase === 'review') heading.current?.focus(); else if (phase === 'unknown' || phase === 'stale') alert.current?.focus(); else if (phase === 'idle') action.current?.focus(); else if (phase === 'current' && view?.operations.some(status => status.technical === 'unknown')) alert.current?.focus(); else if (phase === 'current' && dispatched.current) result.current?.focus(); }, [phase, view]);
  const sourceReady = !!snapshot && snapshot.space === row.space && snapshot.scope === 'private_account_profile' && snapshot.identity.confirmed && snapshot.identity.verification === 'account_confirmation' && snapshot.explicitMemoryAvailable && (!snapshot.identity.bindingExpiresAt || snapshot.identity.bindingExpiresAt > Date.now()) && (!snapshot.explicitMemoryValidUntil || snapshot.explicitMemoryValidUntil > Date.now());
  const eligible = sourceReady && !notesStale ? snapshot.memories.filter(note => !note.origin && !note.sourceRefs && note.expiresAt > Date.now()) : [];
  const note = eligible.find(item => item.id === selected);
  const available = !disabled && !needsNotesRefresh && sourceReady && !notesStale && !!view?.available && !view.operations.some(status => status.technical === 'unknown') && row.kind === 'erasure' && row.state !== 'closed_unfulfilled';
  const cancel = () => { if (dispatched.current || phase === 'submitting') return; generation.current++; controller.current?.abort(); controller.current = null; lock.current = false; clearDraft(); setPhase('idle'); action.current?.focus(); };
  const review = async () => {
    if (lock.current || !available || !note || tg()?.initData !== session) return;
    const g = ++generation.current, abort = new AbortController(); controller.current = abort; lock.current = true; setPhase('planning');
    try {
      const current = await rightsApi.privateNoteErasurePlan(row, { version: 1, eventId: crypto.randomUUID(), expectedRequestRevision: row.revision, space: row.space, memoryId: note.id, expectedMemoryRevision: note.revision, locale }, session, abort.signal);
      if (valid(g)) { setPlan(current); setPhase('review'); }
    } catch { if (valid(g)) { clearDraft(); setPhase('stale'); } }
    finally { if (valid(g)) { lock.current = false; controller.current = null; } }
  };
  const execute = async () => {
    if (lock.current || dispatched.current || !available || phase !== 'review' || !plan || !note || note.id !== plan.memoryId || note.revision !== plan.memoryRevision || plan.expiresAt <= Date.now() || tg()?.initData !== session) return;
    const token = crypto.randomUUID(); if (onPendingChange?.(token, true) === false) return;
    pendingToken.current = token; const g = ++generation.current, abort = new AbortController(); controller.current = abort; lock.current = true; dispatched.current = true;
    const command = plan; clearDraft(); setView(null); setPhase('submitting'); onDispatched?.();
    try { const current = await rightsApi.privateNoteErasureExecute(row, command, session, abort.signal); if (valid(g)) { setView(current); setPhase('current'); } }
    catch { if (valid(g)) setPhase('unknown'); }
    finally { if (valid(g)) { lock.current = false; controller.current = null; release(); } }
  };
  const working = ['loading','planning','submitting'].includes(phase), selecting = ['selecting','planning','review'].includes(phase);
  const buttonStyle = { minHeight: 44, minWidth: 44, maxWidth: '100%', whiteSpace: 'normal' as const, overflowWrap: 'anywhere' as const };
  return <section className="vx-card" dir={locale === 'fa' ? 'rtl' : 'ltr'} lang={locale} aria-labelledby={`${id}-title`} aria-busy={working} style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
    <h4 className="vx-head" id={`${id}-title`}>{c.action}</h4>
    <p id={`${id}-context`} className="vx-small">{c[row.space]} · {c.private}</p><p className="vx-small">{c.intro}</p><p className="vx-small">{c.assurance}</p>
    <p id={`${id}-residual`} className="vx-small">{c.residual}</p>
    <details className="vx-small"><summary style={buttonStyle}>{c.disclosure}</summary><p>{c.details}</p></details>
    <div aria-live="polite" aria-atomic="false">
      {working && <p>{phase === 'submitting' ? c.executing : phase === 'planning' ? c.planning : c.loading}</p>}
      {phase === 'submitting' && <p>{c.close}</p>}
      {phase === 'current' && !!view?.operations.length && <><h5 ref={result} tabIndex={-1}>{c.result}</h5>{view.operations.map((status, index) => <RightsErasureState key={status.operationRef} status={status} locale={locale} unknownRef={index === view.operations.findIndex(item => item.technical === 'unknown') ? alert : undefined} />)}</>}
    </div>
    {['unknown','stale'].includes(phase) && <p ref={alert} tabIndex={-1} role="alert">{phase === 'unknown' ? c.unknown : c.stale}</p>}
    {!working && !available && <p className="vx-small"><span>{c.newActionLabel} </span>{c.unavailable}</p>}
    {available && !selecting && !dispatched.current && phase !== 'unknown' && <button ref={action} style={buttonStyle} className="vx-btn vx-btn-secondary" onClick={() => { clearDraft(); setPhase('selecting'); }}>{c.action}</button>}
    {selecting && <>
      {phase !== 'review' && <fieldset disabled={phase === 'planning' || !available} style={{ minWidth: 0 }}><legend>{c.choose}</legend>
        {!eligible.length && <p>{c.empty}</p>}
        {eligible.map(item => <label key={item.id} style={{ display: 'block', minHeight: 44, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}><input type="radio" name={`${id}-note`} checked={selected === item.id} onChange={() => { setSelected(item.id); setPlan(null); }} /><bdi>{item.text}</bdi><span className="vx-small" style={{ display: 'block' }}>{c.expires}: {rightsDate(item.expiresAt, locale)}</span></label>)}
      </fieldset>}
      {phase === 'review' && plan && note && <section aria-labelledby={`${id}-confirmation`} aria-describedby={`${id}-context ${id}-warning ${id}-residual`}>
        <h5 id={`${id}-confirmation`} ref={heading} tabIndex={-1}>{c.heading}</h5>
        <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}><bdi>{note.text}</bdi></p><p id={`${id}-warning`}>{c.confirmation}</p>
        <button style={buttonStyle} className="vx-btn vx-btn-danger" disabled={!available || working} onClick={() => void execute()}>{c.confirm}</button>
      </section>}
      <div className="vx-privacy-actions" style={{ flexWrap: 'wrap' }}>{phase === 'selecting' && <button style={buttonStyle} className="vx-btn vx-btn-secondary" disabled={!note || !available} onClick={() => void review()}>{c.review}</button>}<button style={buttonStyle} className="vx-btn vx-btn-secondary" onClick={cancel}>{c.cancel}</button></div>
    </>}
    <div className="vx-privacy-actions" style={{ flexWrap: 'wrap' }}>
      <button style={buttonStyle} className="vx-btn vx-btn-secondary" disabled={working || !!disabled} onClick={() => void load(true)}>{c.refresh}</button>
      {onRefreshNotes && <button style={buttonStyle} className="vx-btn vx-btn-secondary" disabled={working || !!disabled} onClick={() => { clearDraft(); setNeedsNotesRefresh(false); if (view && !view.operations.some(status => status.technical === 'unknown')) dispatched.current = false; setPhase('idle'); onRefreshNotes(); }}>{c.refreshNotes}</button>}
    </div>
  </section>;
}
