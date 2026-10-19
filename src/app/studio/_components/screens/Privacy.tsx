'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { adaptiveApi, type AdaptiveOptionalPurpose, type AdaptivePresentation, type AdaptiveSnapshot, type AdaptiveSpace } from '../../_lib/adaptive-client';
import { privacyCopy, purposeCopy, type PrivacyLocale } from '../../_lib/adaptive-copy';
import { Icon, Spinner } from '../ui';
import { api, type AgentView } from '../../_lib/client';
import { VoiceRecognitionPanel } from '../VoiceRecognitionPanel';

export function PrivacyScreen({ onShared, onExperience, onConnections }: { onShared?: () => void; onExperience?: () => void; onConnections?: () => void }) {
  const [locale, setLocale] = useState<PrivacyLocale>('en');
  const [space, setSpace] = useState<AdaptiveSpace>('work');
  const [snapshot, setSnapshot] = useState<AdaptiveSnapshot | null>(null);
  const [presentation, setPresentation] = useState<{ purpose: AdaptiveOptionalPurpose; data: AdaptivePresentation } | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [adult, setAdult] = useState(false);
  const [jurisdiction, setJurisdiction] = useState('');
  const [note, setNote] = useState('');
  const [agents, setAgents] = useState<AgentView[]>([]);
  const generation = useRef(0);
  const c = privacyCopy[locale];

  const load = useCallback(async () => {
    const current = ++generation.current;
    setSnapshot(null); setPresentation(null); setRemoving(null); setError(''); setStatus(''); setNote('');
    try {
      const [result, availableAgents] = await Promise.all([adaptiveApi.read(space, locale), api.agents()]);
      if (generation.current !== current) return;
      setSnapshot(result); setAdult(result.identity.adultDeclared); setJurisdiction(result.identity.declaredJurisdiction ?? '');
      setAgents(availableAgents.agents.filter(a => a.status === 'active'));
    } catch { if (generation.current === current) setError(locale === 'fa' ? 'تنظیمات دریافت نشد. دوباره تلاش کنید.' : 'Your settings could not be loaded. Please try again.'); }
  }, [space, locale]);
  const invalidate = useCallback(() => { generation.current++; }, []);
  useEffect(() => { void load(); return invalidate; }, [load, invalidate]);

  const mutate = async (action: () => Promise<AdaptiveSnapshot>, message: string) => {
    if (busy) return;
    const current = generation.current;
    setBusy(true); setError(''); setStatus('');
    try {
      const result = await action();
      if (generation.current !== current) return;
      setSnapshot(result); setStatus(message); setPresentation(null); setRemoving(null);
    } catch {
      if (generation.current === current) setError(locale === 'fa' ? 'تغییر تأیید نشد. تنظیمات را تازه کنید و دوباره تلاش کنید.' : 'The change was not confirmed. Refresh your settings before trying again.');
    } finally { setBusy(false); }
  };
  const review = async (purpose: AdaptiveOptionalPurpose, revision: number) => {
    if (busy) return;
    const current = generation.current;
    setBusy(true); setError(''); setStatus('');
    try {
      const data = await adaptiveApi.present(space, purpose, revision, locale);
      if (generation.current !== current) return;
      setSnapshot(data); setPresentation({ purpose, data });
    } catch { if (generation.current === current) setError(locale === 'fa' ? 'انتخاب دریافت نشد. تنظیمات را تازه کنید.' : 'This choice could not be opened. Refresh your settings.'); }
    finally { setBusy(false); }
  };

  return <section className="vx-scroll vx-privacy" dir={locale === 'fa' ? 'rtl' : 'ltr'} lang={locale} aria-busy={busy}>
    <header className="vx-privacy-heading">
      <span className="vx-privacy-symbol"><Icon name="shield" size={28} /></span>
      <div><p className="vx-over">{c.subtitle}</p><h1 className="vx-title">{c.title}</h1></div>
      <label className="vx-small">{c.language}<select className="vx-input" value={locale} disabled={busy} onChange={e => setLocale(e.target.value as PrivacyLocale)}><option value="en">English</option><option value="fa">فارسی</option></select></label>
    </header>
    <p className="vx-2">{c.intro}</p>
    {onExperience && <button className="vx-btn vx-btn-secondary" onClick={onExperience}>{locale === 'fa' ? 'ترجیح‌ها و صندوق اعلان' : 'Preferences & notification inbox'}</button>}
    {onConnections && <button className="vx-btn vx-btn-secondary" onClick={onConnections}>{locale === 'fa' ? 'اتصال‌ها و دسترسی عامل‌ها' : 'Connections & agent access'}</button>}
    <div className="vx-privacy-spaces" role="group" aria-label={c.space}>
      {(['work', 'personal'] as const).map(value => <button key={value} className="vx-btn vx-btn-secondary" aria-pressed={space === value} disabled={busy} onClick={() => setSpace(value)}>{c[value]}</button>)}
    </div>
    {error && <div className="vx-banner danger" role="alert">{error}<button className="vx-btn vx-btn-secondary vx-btn-sm" disabled={busy} onClick={() => void load()}>{c.refresh}</button></div>}
    {status && <p className="vx-banner info" role="status">{status}</p>}
    {!snapshot && !error && <p role="status"><Spinner /> {c.loading}</p>}
    <div className="vx-card vx-privacy-card"><h2 className="vx-head">{c.ai}</h2><p className="vx-small vx-2">{c.aiBody}</p></div>
    <p className="vx-small vx-2">{c.operator} · {c.privacyContact}: <a href="mailto:info@joyixir.com" dir="ltr">info@joyixir.com</a></p>
    <p className="vx-small vx-2">{c.registeredAddress}: <span dir="ltr">Harju maakond, Tallinn, Kesklinna linnaosa, Narva mnt 7-652, 10117, Estonia</span></p>
    {snapshot && <>
      <div className="vx-card vx-privacy-card">
        <h2 className="vx-head">{c.identity}</h2><p className="vx-small vx-2">{c.identityBody}</p>
        {snapshot.identity.confirmed ? <p className="vx-privacy-confirmed"><Icon name="check" size={18} /> {c.confirmed}</p> : <>
          <label className="vx-privacy-checkbox"><input type="checkbox" checked={adult} disabled={busy} onChange={e => setAdult(e.target.checked)} />{c.adult}</label>
          <label className="vx-small">{c.jurisdiction}<input className="vx-input" value={jurisdiction} placeholder="EE / US-CA" maxLength={11} disabled={busy} onChange={e => setJurisdiction(e.target.value.toUpperCase())} aria-describedby="jurisdiction-hint" /></label>
          <p id="jurisdiction-hint" className="vx-small vx-2">{c.jurisdictionHint}</p>
          <button className="vx-btn vx-btn-secondary vx-btn-block" disabled={busy || !adult || (!!jurisdiction && !/^[A-Z]{2}(?:-[A-Z0-9]{1,8})?$/.test(jurisdiction))} onClick={() => void mutate(() => adaptiveApi.confirm(space, adult, jurisdiction || undefined), c.confirmed)}>{c.confirm}</button>
        </>}
        <p className="vx-small vx-2">{c.accountNote}</p>
      </div>
      <h2 className="vx-title-m">{c.optional}</h2>
      <VoiceRecognitionPanel key={space} space={space} locale={locale} />
      <div className="vx-group">
        {snapshot.purposes.map(p => {
          const copy = purposeCopy[p.purpose]?.[locale];
          const on = p.state === 'granted';
          const opened = presentation?.purpose === p.purpose;
          return <div key={p.purpose} className="vx-privacy-purpose">
            <div className="vx-privacy-purpose-heading"><h3 className="vx-head">{copy?.title ?? p.notice.title}</h3><span className={`vx-pill ${on && p.available ? 'live' : 'lock'}`}>{on && p.available ? c.on : ['expired', 'reconsent_required', 'suspended'].includes(p.state) || (on && !p.available) ? c.reviewNeeded : c.off}</span></div>
            <p className="vx-small vx-2">{copy?.body ?? p.notice.body}</p>
            {!p.available && <p className="vx-small vx-2">{c.unavailable}</p>}
            {opened ? <div className="vx-privacy-notice" aria-label={c.notice}>
              <h4>{presentation.data.notice.title}</h4><p className="vx-small">{presentation.data.notice.body}</p>
              <p className="vx-small vx-2">{c.noticeVersion}: {presentation.data.notice.version}</p>
              <div className="vx-privacy-actions">
                <button className="vx-btn vx-btn-secondary" disabled={busy} onClick={() => void mutate(() => adaptiveApi.consent(space, p.purpose, p.revision, 'granted', presentation.data.receipt), c.saved)}>{c.enable}</button>
                <button className="vx-btn vx-btn-secondary" disabled={busy} onClick={() => void mutate(() => adaptiveApi.consent(space, p.purpose, p.revision, 'declined', presentation.data.receipt), c.saved)}>{c.decline}</button>
              </div>
            </div> : <button className="vx-btn vx-btn-secondary vx-btn-sm" disabled={busy || (!on && (!p.available || !snapshot.identity.confirmed))} onClick={() => on ? void mutate(() => adaptiveApi.consent(space, p.purpose, p.revision, 'withdrawn'), c.withdrawn) : void review(p.purpose, p.revision)}>{on ? c.withdraw : c.review}</button>}
          </div>;
        })}
      </div>
      <div className="vx-card vx-privacy-card">
        <div className="vx-privacy-purpose-heading"><h2 className="vx-head">{c.memoryTitle}</h2><Icon name="lock" size={20} /></div>
        <p className="vx-small vx-2">{c.memoryBody}</p>
        <label className="vx-small">{c.memoryLabel}<textarea className="vx-textarea" value={note} rows={3} maxLength={2000} disabled={busy || !snapshot.explicitMemoryAvailable} onChange={e => setNote(e.target.value)} /></label>
        <p className="vx-small vx-2">{c[space]} · {c.private}</p>
        {!snapshot.explicitMemoryAvailable && <p className="vx-small vx-2">{c.unavailable}</p>}
        <button className="vx-btn vx-btn-secondary vx-btn-block" disabled={busy || !note.trim() || !snapshot.explicitMemoryAvailable} onClick={() => void mutate(async () => { const result = await adaptiveApi.save(space, note, snapshot.revision); setNote(''); return result; }, c.saved)}>{c.saveMemory}</button>
        {!snapshot.memories.length && <p className="vx-small vx-2">{c.empty}</p>}
        {snapshot.memories.map(m => <article key={m.id} className="vx-privacy-note">
          <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{m.text}</p>
          <p className="vx-small vx-2">{c.expires}: {new Date(m.expiresAt).toLocaleDateString(locale === 'fa' ? 'fa-IR' : 'en-GB')}</p>
          {removing === m.id ? <div>
            <h3 className="vx-small">{c.deleteTitle}</h3><p className="vx-small vx-2">{c.deleteBody}</p>
            <div className="vx-privacy-actions"><button className="vx-btn vx-btn-danger vx-btn-sm" disabled={busy} onClick={() => void mutate(() => adaptiveApi.remove(space, m.id, m.revision), c.deleted)}>{c.remove}</button><button className="vx-btn vx-btn-secondary vx-btn-sm" disabled={busy} onClick={() => setRemoving(null)}>{c.cancel}</button></div>
          </div> : <button className="vx-btn vx-btn-secondary vx-btn-sm" disabled={busy} onClick={() => setRemoving(m.id)}>{c.remove}</button>}
        </article>)}
      </div>
      <div className="vx-card vx-privacy-card">
        <h2 className="vx-head">{c.agents}</h2><p className="vx-small vx-2">{c.agentsBody}</p>
        {!agents.length && <p className="vx-small vx-2">{c.noAgents}</p>}
        {agents.map(agent => {
          const allowed = snapshot.agents.some(g => g.agentId === agent.id && g.allowed);
          return <div className="vx-privacy-purpose-heading" key={agent.id}><span>{agent.persona.name}</span><button className="vx-btn vx-btn-secondary vx-btn-sm" disabled={busy || !snapshot.identity.confirmed} aria-label={`${allowed ? c.revokeAgent : c.allowAgent}: ${agent.persona.name}`} onClick={() => void mutate(() => adaptiveApi.agent(space, agent.id, !allowed, snapshot.revision), c.saved)}>{allowed ? c.revokeAgent : c.allowAgent}</button></div>;
        })}
      </div>
      <div className="vx-card vx-privacy-card"><h2 className="vx-head">{c.sharing}</h2><p className="vx-small vx-2">{c.sharingBody}</p>{onShared && <button className="vx-btn vx-btn-secondary" onClick={onShared}>{locale === 'fa' ? 'حافظه‌های مشترک' : 'Shared memories'}</button>}</div>
      <div className="vx-card vx-privacy-card"><h2 className="vx-head">{c.voice}</h2><p className="vx-small vx-2">{c.voiceBody}</p></div>
    </>}
  </section>;
}
