'use client';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { adaptiveApi, type AdaptiveSnapshot } from '../_lib/adaptive-client';
import type { PrivacyLocale } from '../_lib/adaptive-copy';
type Note = AdaptiveSnapshot['memories'][number];
/** No inferred rewrite. The person reviews the exact replacement text and
 * current private destination before the one explicit CAS Save. */
export function MemoryCorrectionEditor({ note, snapshot, locale, disabled, onSaved, onRefresh }: {
  note: Note; snapshot: AdaptiveSnapshot; locale: PrivacyLocale; disabled: boolean;
  onSaved(snapshot: AdaptiveSnapshot): void; onRefresh(): void;
}) {
  const fa = locale === 'fa', t = (en: string, persian: string) => fa ? persian : en, labelId = useId();
  const [stage, setStage] = useState<'closed' | 'edit' | 'review'>('closed');
  const [text, setText] = useState(''), [prepared, setPrepared] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement | null>(null), reviewRef = useRef<HTMLHeadingElement | null>(null);
  const generation = useRef(0), request = useRef<AbortController | null>(null);
  const invalidate = useCallback(() => { generation.current++; request.current?.abort(); request.current = null; }, []);
  const clear = () => { invalidate(); setStage('closed'); setText(''); setPrepared(''); setBusy(false); setError(false); };
  useEffect(() => {
    invalidate(); setStage('closed'); setText(''); setPrepared(''); setBusy(false); setError(false);
    return invalidate;
  }, [invalidate, snapshot.space, snapshot.identity.accountId, snapshot.identity.personId, snapshot.identity.confirmed, snapshot.identity.bindingId, snapshot.identity.bindingRevision, snapshot.memoryCorrectionAvailable, snapshot.explicitMemoryValidUntil, note.id, note.revision, note.text, locale, disabled]);
  useEffect(() => { if (stage === 'edit') inputRef.current?.focus(); else if (stage === 'review') reviewRef.current?.focus(); }, [stage]);
  useEffect(() => {
    if (!snapshot.memoryCorrectionAvailable || !snapshot.identity.confirmed || note.sourceRefs) return;
    const deadline = Math.min(note.expiresAt, snapshot.identity.bindingExpiresAt ?? Infinity, snapshot.explicitMemoryValidUntil ?? Infinity);
    const timer = setTimeout(() => { invalidate(); setStage('closed'); setText(''); setPrepared(''); setBusy(false); }, Math.min(2_147_483_647, Math.max(0, deadline - Date.now())));
    return () => clearTimeout(timer);
  }, [invalidate, note.expiresAt, note.sourceRefs, snapshot.identity.bindingExpiresAt, snapshot.explicitMemoryValidUntil, snapshot.memoryCorrectionAvailable, snapshot.identity.confirmed]);
  if (!snapshot.memoryCorrectionAvailable || !snapshot.identity.confirmed || note.sourceRefs) return null;
  const allowed = !disabled && note.expiresAt > Date.now() && (snapshot.identity.bindingExpiresAt ?? Infinity) > Date.now() && (snapshot.explicitMemoryValidUntil ?? Infinity) > Date.now();
  const save = async () => {
    if (!allowed || busy || request.current || stage !== 'review' || !prepared) return;
    const epoch = generation.current, controller = new AbortController(); request.current = controller; setBusy(true); setError(false);
    try {
      const result = await adaptiveApi.correct(note.id, { space: snapshot.space, text: prepared, expectedRevision: note.revision, eventId: crypto.randomUUID() }, controller.signal, locale);
      if (controller.signal.aborted || epoch !== generation.current) return;
      setStage('closed'); setText(''); setPrepared(''); onSaved(result);
    } catch { if (epoch === generation.current && !controller.signal.aborted) setError(true); }
    finally { if (request.current === controller) request.current = null; if (epoch === generation.current) setBusy(false); }
  };
  if (stage === 'closed') return <button className="vx-btn vx-btn-secondary vx-btn-sm" disabled={!allowed} onClick={() => { setText(note.text); setPrepared(''); setError(false); setStage('edit'); }}>{t('Edit note', 'ویرایش یادداشت')}</button>;
  return <section aria-label={t('Correct private note', 'اصلاح یادداشت خصوصی')} dir={fa ? 'rtl' : 'ltr'} lang={locale} aria-busy={busy}>
    <p className="vx-small">{t('Private to you', 'خصوصی برای شما')} · {snapshot.space === 'work' ? t('Work', 'کاری') : t('Personal', 'شخصی')}</p>
    <p className="vx-small">{t('Saving replaces this note and removes summaries that depend on its old version. Its original expiry and sharing permissions stay the same.', 'ذخیره، این یادداشت را جایگزین و خلاصه‌های وابسته به نسخهٔ قبلی را حذف می‌کند. مهلت اصلی و مجوزهای اشتراک آن تغییر نمی‌کنند.')}</p>
    {stage === 'edit' ? <>
      <label className="vx-small" htmlFor={labelId}>{t('Corrected note', 'یادداشت اصلاح‌شده')}</label>
      <textarea ref={inputRef} id={labelId} className="vx-textarea" value={text} rows={3} maxLength={2000} disabled={busy || !allowed} onChange={event => setText(event.target.value)} />
      <button className="vx-btn vx-btn-secondary vx-btn-sm" disabled={!allowed || busy || !text.trim() || text.trim() === note.text} onClick={() => { setPrepared(text.trim()); setStage('review'); }}>{t('Review correction', 'بررسی اصلاح')}</button>
    </> : <>
      <h4 ref={reviewRef} tabIndex={-1}>{t('Before', 'پیش از اصلاح')}</h4><p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{note.text}</p>
      <h4>{t('After saving', 'پس از ذخیره')}</h4><p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{prepared}</p>
      <button className="vx-btn vx-btn-secondary vx-btn-sm" disabled={!allowed || busy || error} onClick={() => void save()}>{t('Save correction', 'ذخیرهٔ اصلاح')}</button>
      <button className="vx-btn vx-btn-secondary vx-btn-sm" disabled={busy || error} onClick={() => { setStage('edit'); setPrepared(''); setError(false); }}>{t('Back to edit', 'بازگشت به ویرایش')}</button>
    </>}
    <button className="vx-btn vx-btn-secondary vx-btn-sm" onClick={() => { const pending = busy; clear(); if (pending) onRefresh(); }}>{t('Cancel', 'انصراف')}</button>
    {error && <div role="alert"><p>{t('The note may have changed or this correction was not confirmed. Refresh notes and review again.', 'ممکن است یادداشت تغییر کرده باشد یا اصلاح تأیید نشده باشد. یادداشت‌ها را تازه‌سازی و دوباره بررسی کنید.')}</p>
      <button className="vx-btn vx-btn-secondary vx-btn-sm" onClick={() => { clear(); onRefresh(); }}>{t('Refresh notes', 'تازه‌سازی یادداشت‌ها')}</button></div>}
  </section>;
}
