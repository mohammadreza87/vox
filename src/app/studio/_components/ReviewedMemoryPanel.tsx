'use client';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { adaptiveApi, type AdaptiveSnapshot } from '../_lib/adaptive-client';
import type { AgentView } from '../_lib/client';
import type { ReviewedMemoryPreview } from '@/lib/adaptive/reviewed-memory/contracts';

export function ReviewedMemoryPanel({ snapshot, agents, locale, disabled, onSaved }: { snapshot: AdaptiveSnapshot; agents: AgentView[];
  locale: 'en' | 'fa'; disabled: boolean; onSaved: (snapshot: AdaptiveSnapshot) => void }) {
  const [selected, setSelected] = useState<string[]>([]), [agentId, setAgentId] = useState('');
  const [preview, setPreview] = useState<ReviewedMemoryPreview | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [now, setNow] = useState(Date.now());
  const epoch = useRef(0), controller = useRef<AbortController | null>(null);
  const t = (en: string, fa: string) => locale === 'fa' ? fa : en;
  useLayoutEffect(() => { epoch.current++; controller.current?.abort(); setPreview(null); setSelected([]); setError(''); setBusy(false);
    // Invalidate the live request generation on cleanup, not a captured value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return () => { epoch.current++; controller.current?.abort(); };
  }, [snapshot.space, snapshot.identity.bindingId, snapshot.revision, locale]);
  useEffect(() => { if (!preview) return; const timer = setInterval(() => setNow(Date.now()), 500); return () => clearInterval(timer); }, [preview]);
  const change = () => { epoch.current++; controller.current?.abort(); setPreview(null); setError(''); setBusy(false); };
  const run = async (save: boolean) => {
    if (busy || disabled) return;
    const current = ++epoch.current, abort = new AbortController(); controller.current?.abort(); controller.current = abort;
    const chosen = snapshot.memories.filter(memory => selected.includes(memory.id));
    setBusy(true); setError('');
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
  return <section className="vx-card vx-privacy-card" aria-label={t('Review private saved notes', 'بررسی یادداشت‌های خصوصی')} aria-busy={busy} dir={locale === 'fa' ? 'rtl' : 'ltr'}>
    <h2 className="vx-head">{t('Review selected notes', 'بررسی یادداشت‌های انتخاب‌شده')}</h2>
    <p className="vx-small">{t('Choose 2–8 of your saved notes in this space and an allowed agent. Only these notes go to its AI provider for a proposed summary. Nothing is saved until you choose Save reviewed summary. This does not turn on automatic memory or share anything.', '۲ تا ۸ یادداشت ذخیره‌شدهٔ خود در این فضا و یک عامل مجاز را انتخاب کنید. فقط همین یادداشت‌ها برای پیش‌نویس خلاصه به ارائه‌دهندهٔ هوش مصنوعی فرستاده می‌شوند. تا انتخاب «ذخیرهٔ خلاصهٔ بررسی‌شده»، چیزی ذخیره نمی‌شود. حافظهٔ خودکار یا اشتراک‌گذاری فعال نمی‌شود.')}</p>
    <p className="vx-small">{snapshot.space === 'work' ? t('Work · Private to you', 'کاری · فقط برای شما') : t('Personal · Private to you', 'شخصی · فقط برای شما')}</p>
    <label>{t('Agent for this review', 'عامل این بررسی')}<select className="vx-input" aria-label={t('Agent for this review', 'عامل این بررسی')} value={agentId} disabled={busy || disabled} onChange={event => { change(); setAgentId(event.target.value); }}>
      <option value="">{t('Choose an allowed agent', 'عامل مجاز را انتخاب کنید')}</option>{available.map(agent => <option key={agent.id} value={agent.id}>{agent.persona.name}</option>)}
    </select></label>
    {!available.length && <p>{t('Allow an agent below before requesting a review.', 'پیش از درخواست بررسی، پایین همین صفحه به یک عامل دسترسی بدهید.')}</p>}
    <fieldset disabled={busy || disabled || !snapshot.identity.confirmed}><legend>{t('Notes to review', 'یادداشت‌های بررسی')}</legend>
      {snapshot.memories.map(memory => <label className="vx-privacy-checkbox" key={memory.id}><input type="checkbox" checked={selected.includes(memory.id)} disabled={!selected.includes(memory.id) && selected.length >= 8}
        onChange={event => { change(); setSelected(rows => event.target.checked ? [...rows, memory.id] : rows.filter(id => id !== memory.id)); }} />{memory.text}</label>)}
    </fieldset>
    <button className="vx-btn vx-btn-secondary" disabled={busy || disabled || !agentId || !available.some(agent => agent.id === agentId) || selected.length < 2 || !snapshot.identity.confirmed} onClick={() => void run(false)}>{t('Create summary preview', 'ساخت پیش‌نمایش خلاصه')}</button>
    {preview && <div aria-label={t('Ephemeral summary preview', 'پیش‌نمایش موقت خلاصه')}>
      <p className="vx-small">{t('AI draft: verify facts and qualifications before saving. Original notes remain. Deleting a source also removes summaries derived from it. Deleting a summary keeps its originals.', 'پیش‌نویس هوش مصنوعی: پیش از ذخیره، واقعیت‌ها و قیدها را بررسی کنید. اصل یادداشت‌ها می‌ماند. حذف منبع، خلاصه‌های مشتق از آن را نیز حذف می‌کند. حذف خلاصه، اصل یادداشت‌ها را نگه می‌دارد.')}</p>
      <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{preview.text}</p>
      {expired && <p role="status">{t('This preview expired. Request a new preview.', 'این پیش‌نمایش منقضی شد. پیش‌نمایش تازه بخواهید.')}</p>}
      <button className="vx-btn vx-btn-secondary" disabled={busy || disabled || expired} onClick={() => void run(true)}>{t('Save reviewed summary', 'ذخیرهٔ خلاصهٔ بررسی‌شده')}</button>
      <button className="vx-btn vx-btn-secondary" disabled={busy} onClick={() => change()}>{t('Discard preview', 'کنارگذاشتن پیش‌نمایش')}</button>
    </div>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
