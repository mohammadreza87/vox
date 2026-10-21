'use client';
import { useEffect, useLayoutEffect, useId, useRef, useState } from 'react';
import { adaptiveApi, type AdaptiveSnapshot } from '../_lib/adaptive-client';
import type { AgentView } from '../_lib/client';
import { pauseText } from '../_lib/product-pause-copy';
import type { ReviewedMemoryPreview } from '@/lib/adaptive/reviewed-memory/contracts';
import { haptic } from '../_lib/haptics';
import { Check, Icon, Radio, Row, Section, SheetHead, Spinner } from './ui';

export function ReviewedMemoryPanel({ snapshot, agents, locale, disabled, onSaved, pauseBlocked = false, personalizationPaused = false, pauseEpoch }: { snapshot: AdaptiveSnapshot; agents: AgentView[];
  locale: 'en' | 'fa'; disabled: boolean; pauseBlocked?: boolean; personalizationPaused?: boolean; pauseEpoch?: number; onSaved: (snapshot: AdaptiveSnapshot) => void }) {
  const [selected, setSelected] = useState<string[]>([]), [agentId, setAgentId] = useState('');
  const [preview, setPreview] = useState<ReviewedMemoryPreview | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const previewRef = useRef(preview); previewRef.current = preview;
  const blocked = pauseBlocked || snapshot.storedPersonalizationAllowed === false;
  const unavailable = disabled || blocked;
  const paused = personalizationPaused || snapshot.storedPersonalizationAllowed === false;
  const reasonId = useId();
  const [invalidated, setInvalidated] = useState(false);
  const [now, setNow] = useState(Date.now());
  const epoch = useRef(0), controller = useRef<AbortController | null>(null);
  const t = (en: string, fa: string) => locale === 'fa' ? fa : en;
  useLayoutEffect(() => { epoch.current++; controller.current?.abort(); setInvalidated(!!previewRef.current); setPreview(null); setSelected([]); setError(''); setBusy(false);
    // Invalidate the live request generation on cleanup, not a captured value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return () => { epoch.current++; controller.current?.abort(); };
  }, [snapshot.space, snapshot.identity.bindingId, snapshot.revision, snapshot.storedPersonalizationAllowed, snapshot.storedPersonalizationUseStamp, pauseBlocked, pauseEpoch, locale]);
  useEffect(() => { if (!preview) return; const timer = setInterval(() => setNow(Date.now()), 500); return () => clearInterval(timer); }, [preview]);
  const change = () => { epoch.current++; controller.current?.abort(); setPreview(null); setError(''); setBusy(false); };
  const run = async (save: boolean) => {
    if (busy || unavailable) return;
    const current = ++epoch.current, abort = new AbortController(); controller.current?.abort(); controller.current = abort;
    const chosen = snapshot.memories.filter(memory => selected.includes(memory.id));
    setBusy(true); setError(''); setInvalidated(false);
    try {
      if (save && preview) {
        const result = await adaptiveApi.reviewedAccept({ space: snapshot.space, agentId, text: preview.text, receipt: preview.receipt }, abort.signal);
        if (epoch.current !== current || abort.signal.aborted) return;
        setPreview(null); setSelected([]); onSaved(result.snapshot);
      } else {
        const result = await adaptiveApi.reviewedPreview({ space: snapshot.space, agentId, locale,
          sourceRefs: chosen.map(memory => ({ id: memory.id, revision: memory.revision })) }, abort.signal);
        if (epoch.current !== current || abort.signal.aborted) return;
        setNow(Date.now()); setPreview(result);
      }
    } catch { if (epoch.current === current && !abort.signal.aborted) setError(t('The review could not be confirmed. Refresh your notes and try again.', 'بررسی تأیید نشد. یادداشت‌ها را تازه کنید و دوباره تلاش کنید.')); }
    finally { if (epoch.current === current) setBusy(false); }
  };
  const available = agents.filter(agent => snapshot.agents.some(grant => grant.agentId === agent.id && grant.allowed));
  const expired = !!preview && preview.expiresAt <= now;
  const ready = !busy && !unavailable && !!agentId && available.some(agent => agent.id === agentId) && selected.length >= 2 && snapshot.identity.confirmed;
  return <section className="vx-sheet-stack" aria-label={t('Review private saved notes', 'بررسی یادداشت‌های خصوصی')} aria-busy={busy} dir={locale === 'fa' ? 'rtl' : 'ltr'}>
    <SheetHead title={t('Review selected notes', 'بررسی یادداشت‌های انتخاب‌شده')} sub={snapshot.space === 'work' ? t('Work · Private to you', 'کاری · فقط برای شما') : t('Personal · Private to you', 'شخصی · فقط برای شما')} />
    <p className="vx-footnote">{t('Choose 2–8 of your saved notes in this space and an allowed agent. Only these notes go to its AI provider for a proposed summary. Nothing is saved until you choose Save reviewed summary. This does not turn on automatic memory or share anything.', '۲ تا ۸ یادداشت ذخیره‌شدهٔ خود در این فضا و یک عامل مجاز را انتخاب کنید. فقط همین یادداشت‌ها برای پیش‌نویس خلاصه به ارائه‌دهندهٔ هوش مصنوعی فرستاده می‌شوند. تا انتخاب «ذخیرهٔ خلاصهٔ بررسی‌شده»، چیزی ذخیره نمی‌شود. حافظهٔ خودکار یا اشتراک‌گذاری فعال نمی‌شود.')}</p>
    {blocked && <p id={reasonId} className="vx-small vx-2">{paused ? pauseText(locale, snapshot.space, 'summaryDisabled') : t('Pause status could not be verified. Check current status.', 'وضعیت مکث قابل تأیید نیست. وضعیت فعلی را بررسی کنید.')}</p>}
    {invalidated && <p className="vx-small" role="status">{pauseText(locale, snapshot.space, 'summaryInvalidated')}</p>}
    <Section title={t('Agent for this review', 'عامل این بررسی')}>
      {!available.length ? <Row plain title={<span className="vx-2">{t('Allow an agent in Agent access before requesting a review.', 'پیش از درخواست بررسی، در «دسترسی عامل‌ها» به یک عامل اجازه بدهید.')}</span>} />
        : <div role="radiogroup" aria-label={t('Agent for this review', 'عامل این بررسی')}>{available.map(agent =>
          <Row key={agent.id} role="radio" aria-checked={agentId === agent.id} plain title={agent.persona.name} end={<Radio />} disabled={busy || unavailable}
            onClick={() => { haptic.select(); change(); setAgentId(agent.id); }} />)}</div>}
    </Section>
    <Section title={t('Notes to review', 'یادداشت‌های بررسی')} foot={`${selected.length}/8`}>
      {snapshot.memories.map(memory => {
        const on = selected.includes(memory.id);
        return <Row key={memory.id} role="checkbox" aria-checked={on} aria-label={memory.text} plain title={<span className="vx-clamp-2" dir="auto">{memory.text}</span>} end={<Check />}
          disabled={busy || unavailable || !snapshot.identity.confirmed || (!on && selected.length >= 8)}
          onClick={() => { haptic.select(); change(); setSelected(rows => on ? rows.filter(id => id !== memory.id) : [...rows, memory.id]); }} />;
      })}
    </Section>
    {preview && <div className="vx-remember-preview" aria-label={t('Ephemeral summary preview', 'پیش‌نمایش موقت خلاصه')}>
      <p className="vx-remember-quote" dir="auto">{preview.text}</p>
      <p className="vx-footnote">{t('AI draft: verify facts and qualifications before saving. Original notes remain. Deleting a source also removes summaries derived from it. Deleting a summary keeps its originals.', 'پیش‌نویس هوش مصنوعی: پیش از ذخیره، واقعیت‌ها و قیدها را بررسی کنید. اصل یادداشت‌ها می‌ماند. حذف منبع، خلاصه‌های مشتق از آن را نیز حذف می‌کند. حذف خلاصه، اصل یادداشت‌ها را نگه می‌دارد.')}</p>
      {expired && <p className="vx-small" role="status">{t('This preview expired. Request a new preview.', 'این پیش‌نمایش منقضی شد. پیش‌نمایش تازه بخواهید.')}</p>}
    </div>}
    {error && <div className="vx-banner danger"><Icon name="warn" size={18} /><div className="vx-banner-body"><span role="alert">{error}</span></div></div>}
    <div className="vx-remember-actions">
      {preview && <button className="vx-btn vx-btn-primary vx-btn-block" aria-describedby={blocked ? reasonId : undefined} disabled={busy || unavailable || expired} onClick={() => void run(true)}>{t('Save reviewed summary', 'ذخیرهٔ خلاصهٔ بررسی‌شده')}</button>}
      <button className={`vx-btn vx-btn-block ${preview ? 'vx-btn-ghost' : 'vx-btn-secondary'}`} aria-describedby={blocked ? reasonId : undefined} disabled={!ready} onClick={() => void run(false)}>
        {busy && !preview ? <Spinner /> : null}{t('Create summary preview', 'ساخت پیش‌نمایش خلاصه')}</button>
      {preview && <button className="vx-btn vx-btn-ghost vx-btn-sm" disabled={busy} onClick={() => change()}>{t('Discard preview', 'کنارگذاشتن پیش‌نمایش')}</button>}
    </div>
  </section>;
}
