'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { preferenceLearningApi } from '../_lib/preference-learning-client';
import { Banner, Icon, Row } from './ui';
import { learningNotice, LEARNING_VERSION, type LearningPublicView } from '@/lib/adaptive/personalization/learning/contracts';
const labels: Record<string, [string, string]> = {
  response_length: ['Reply length', 'اندازهٔ پاسخ'], language: ['Reply language', 'زبان پاسخ'], formatting: ['Reply format', 'قالب پاسخ'],
  brief: ['Brief', 'کوتاه'], balanced: ['Balanced', 'متعادل'], detailed: ['Detailed', 'با جزئیات'], auto: ['Automatic', 'خودکار'],
  en: ['English', 'انگلیسی'], fa: ['Persian', 'فارسی'], plain: ['Plain', 'ساده'], structured: ['Structured', 'ساختاریافته'],
};
const reasons = {
  length_cue: ['A recent final message may indicate a reply length preference.', 'یک پیام نهایی اخیر ممکن است ترجیحی دربارهٔ اندازهٔ پاسخ نشان دهد.'],
  language_cue: ['A recent final message may indicate a reply language preference.', 'یک پیام نهایی اخیر ممکن است ترجیحی دربارهٔ زبان پاسخ نشان دهد.'],
  formatting_cue: ['A recent final message may indicate a reply format preference.', 'یک پیام نهایی اخیر ممکن است ترجیحی دربارهٔ قالب پاسخ نشان دهد.'],
} as const;
export function PreferenceLearningPanel({ agentId, space, confirmed, revisionHint, locale = 'en', onRevision }: {
  agentId: string; space: 'work' | 'personal'; confirmed: boolean; revisionHint: number; locale?: 'en' | 'fa'; onRevision(revision: number): void;
}) {
  const fa = locale === 'fa', t = (en: string, persian: string) => fa ? persian : en;
  const [state, setState] = useState<LearningPublicView | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(false), [status, setStatus] = useState('');
  const current = useRef<LearningPublicView | null>(null), generation = useRef(0), changing = useRef<number | null>(null), sequence = useRef(0);
  const refreshedExpiry = useRef<string | null>(null);
  const loadingRequest = useRef<AbortController | null>(null), commandRequest = useRef<AbortController | null>(null);
  const invalidate = useCallback(() => { generation.current++; changing.current = null; loadingRequest.current?.abort(); commandRequest.current?.abort(); }, []);
  useEffect(() => () => { invalidate(); if (agentId) void preferenceLearningApi.cancel(space, agentId); }, [agentId, space, confirmed, invalidate]);
  const load = useCallback(async () => {
    // A replacement view owns the new generation, including when only the
    // aggregate revision or a deadline changed within the same scope.
    commandRequest.current?.abort(); commandRequest.current = null; changing.current = null;
    const controller = new AbortController(); loadingRequest.current?.abort(); loadingRequest.current = controller;
    const epoch = ++generation.current; setBusy(true); setError(false); setStatus('');
    try { const view = await preferenceLearningApi.read(space, agentId, controller.signal); if (epoch === generation.current) { current.current = view; setState(view); } }
    catch { if (epoch === generation.current) { current.current = null; setState(null); setError(true); } }
    finally { if (epoch === generation.current) setBusy(false); }
  }, [space, agentId]);
  useEffect(() => {
    if (!agentId || !confirmed) { current.current = null; setState(null); setBusy(false); setStatus(''); return; }
    if (current.current?.agentId !== agentId || current.current.space !== space || current.current.revision !== revisionHint) void load();
  }, [agentId, space, confirmed, revisionHint, load]);
  useEffect(() => {
    const deadline = Math.min(state?.intentExpiresAt ?? Infinity, state?.presentation?.expiresAt ?? Infinity, ...(state?.candidates.map(c => c.expiresAt) ?? []));
    if (!Number.isFinite(deadline)) return;
    const key = `${agentId}:${space}:${deadline}`;
    if (refreshedExpiry.current === key) return;
    const timer = setTimeout(() => { refreshedExpiry.current = key; current.current = null; setState(null); void load(); }, Math.max(0, deadline - Date.now()) + 1);
    return () => clearTimeout(timer);
  }, [state, load, agentId, space]);
  const change = async (action: 'present' | 'on' | 'off' | 'use' | 'dismiss', candidateId?: string) => {
    const before = current.current;
    if (!before || changing.current !== null) return;
    const commandId = ++sequence.current, controller = new AbortController(); commandRequest.current = controller;
    changing.current = commandId; setBusy(true); setError(false); setStatus(''); const epoch = generation.current;
    try {
      const command = { agentId, space, expectedRevision: before.revision, eventId: crypto.randomUUID() };
      const next = action === 'present' ? await preferenceLearningApi.present({ ...command, locale }, controller.signal)
        : action === 'on' || action === 'off' ? await preferenceLearningApi.toggle({ ...command, enabled: action === 'on',
          ...(action === 'on' ? { receipt: before.presentation?.receipt, version: LEARNING_VERSION } : {}) }, controller.signal)
          : await preferenceLearningApi.review({ ...command, action, candidateId: candidateId! }, controller.signal);
      if (epoch !== generation.current) return;
      current.current = next; setState(next); setBusy(false); setStatus(action === 'use' ? 'used' : action === 'dismiss' ? 'dismissed' : action === 'off' ? 'off' : action === 'on' ? 'on' : ''); onRevision(next.revision);
    } catch { if (epoch === generation.current) { current.current = null; setState(null); setError(true); } }
    finally { if (changing.current === commandId) changing.current = null; if (epoch === generation.current) setBusy(false); }
  };
  if (!agentId || !confirmed) return null;
  const view = state?.agentId === agentId && state.space === space ? state : null;
  const title = t('Suggestion learning', 'یادگیری پیشنهادها');
  const candidates = view?.candidates.filter(candidate => candidate.expiresAt > Date.now()) ?? [];
  return <section aria-label={t('Suggested preferences', 'ترجیح‌های پیشنهادی')} className="vx-section vx-learn" dir={fa ? 'rtl' : 'ltr'} lang={locale} aria-busy={busy}>
    <div className="vx-section-head">
      <h3 className="vx-over">{t('Suggested preferences', 'ترجیح‌های پیشنهادی')}</h3>
      <button type="button" className="vx-icon-btn" disabled={busy} onClick={() => void load()} aria-label={t('Refresh suggestions', 'تازه‌سازی پیشنهادها')}><Icon name="refresh" size={18} /></button>
    </div>
    {error && <Banner tone="danger">{t('The change or current choices could not be confirmed. Refresh and review before trying again.', 'تغییر یا انتخاب فعلی تأیید نشد. پیش از تلاش دوباره تازه‌سازی و بررسی کنید.')}</Banner>}
    <div className="vx-group">
      {!view && !error && <Row plain title={title} sub={t('Checking…', 'در حال بررسی…')} />}
      {view && !view.available && <Row plain title={title} sub={view.reason === 'personalization_off' ? t('Personalization is off or expired. You can keep using the ordinary explicit preferences.', 'شخصی‌سازی خاموش یا منقضی است. ترجیح‌های صریح معمولی همچنان قابل استفاده‌اند.')
        : view.reason === 'agent_grant_missing' ? t('This agent needs a current grant in this space.', 'این عامل در این فضا به مجوز فعلی نیاز دارد.') : t('Suggestion learning is unavailable here. Ordinary explicit preferences still work.', 'یادگیری پیشنهادها اینجا در دسترس نیست. ترجیح‌های صریح معمولی همچنان کار می‌کنند.')} />}
      {view?.available && !view.enabled && view.presentation?.locale !== locale && <Row plain title={title} sub={t('Off', 'خاموش')}
        end={<button type="button" className="vx-btn vx-btn-tonal vx-btn-xs" disabled={busy} onClick={() => void change('present')}>{t('Review suggestion learning', 'بررسی یادگیری پیشنهادها')}</button>} />}
      {view?.available && !view.enabled && view.presentation?.locale === locale && <div className="vx-row top vx-learn-notice">
        <span className="vx-row-main">
          <span className="vx-row-title plain">{title}</span>
          <span className="vx-learn-text" dir="auto">{learningNotice[locale]}</span>
          {/* Equal weight on purpose: keeping it off is exactly as easy as turning it on. */}
          <span className="vx-dock-row">
            <button type="button" className="vx-btn vx-btn-secondary vx-btn-sm" disabled={busy} onClick={() => void change('off')}>{t('Keep off', 'خاموش بماند')}</button>
            <button type="button" className="vx-btn vx-btn-secondary vx-btn-sm" disabled={busy} onClick={() => void change('on')}>{t('Enable suggestions', 'فعال کردن پیشنهادها')}</button>
          </span>
        </span>
      </div>}
      {view?.enabled && <Row plain title={title} sub={<>{t('On until: ', 'روشن تا: ')}{new Date(view.intentExpiresAt!).toLocaleString(locale)}</>}
        end={<button type="button" className="vx-btn vx-btn-ghost vx-btn-xs" disabled={busy} onClick={() => void change('off')}>{t('Turn suggestion learning off', 'خاموش کردن یادگیری پیشنهادها')}</button>} />}
      {candidates.map(candidate => <article key={candidate.id} className="vx-row top vx-learn-candidate" aria-label={`${labels[candidate.setting.key][fa ? 1 : 0]}: ${labels[candidate.setting.value][fa ? 1 : 0]}`}>
        <span className="vx-tile icon" aria-hidden="true"><Icon name="spark" size={20} /></span>
        <span className="vx-row-main">
          <span className="vx-row-title">{labels[candidate.setting.key][fa ? 1 : 0]}: {labels[candidate.setting.value][fa ? 1 : 0]}</span>
          <span className="vx-row-sub">{reasons[candidate.reason][fa ? 1 : 0]} {t('This is a suggestion, not a fact about you.', 'این یک پیشنهاد است، نه واقعیتی دربارهٔ شما.')}</span>
          <span className="vx-row-sub">{t('Expires: ', 'پایان مهلت: ')}{new Date(candidate.expiresAt).toLocaleString(locale)}</span>
          <span className="vx-pref-actions">
            <button type="button" className="vx-btn vx-btn-tonal vx-btn-xs" disabled={busy} onClick={() => void change('use', candidate.id)}>{t('Use preference', 'استفاده از ترجیح')}</button>
            <button type="button" className="vx-btn vx-btn-ghost vx-btn-xs" disabled={busy} onClick={() => void change('dismiss', candidate.id)}>{t('Dismiss suggestion', 'کنار گذاشتن پیشنهاد')}</button>
          </span>
        </span>
      </article>)}
    </div>
    {status && <p className="vx-pref-status" role="status"><Icon name="check" size={14} width={2.5} />{status === 'used' ? t('Preference saved. Its Undo is in Reply preferences.', 'ترجیح ذخیره شد. واگرد آن در بخش ترجیح‌های پاسخ است.')
      : status === 'dismissed' ? t('Suggestion dismissed.', 'پیشنهاد کنار گذاشته شد.') : status === 'off' ? t('Suggestion learning is off.', 'یادگیری پیشنهادها خاموش است.') : t('Suggestion learning is on for this account confirmation.', 'یادگیری پیشنهادها برای این تأیید حساب روشن است.')}</p>}
    <p className="vx-section-foot">{t('Off until you choose it. Suggestions never change a reply preference until you review and use them.', 'تا انتخاب شما خاموش است. پیشنهادها تا زمانی که بررسی و استفاده نکنید، ترجیح پاسخ را تغییر نمی‌دهند.')}</p>
  </section>;
}
