'use client';
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { adaptiveApi, type AdaptiveSnapshot, type AdaptiveSpace } from '../_lib/adaptive-client';
import { learningApi } from '../_lib/learning-client';
import { tg } from '../_lib/client';
import type { PrivacyLocale } from '../_lib/adaptive-copy';
type Note = AdaptiveSnapshot['memories'][number];
export const MEMORY_CORRECTION_SAVE_TIMEOUT_MS = 15_000;
type PendingSave = { controller: AbortController; timer?: ReturnType<typeof setTimeout>; release(): void };
/** Cancel discards only an undispatched draft. A dispatched Save may commit even
 * when fetch is aborted; the UI owns its scoped outcome, not server rollback. */
export function MemoryCorrectionEditor({ note, snapshot, locale, disabled, onSaved, onRefresh, onPendingChange, onUnconfirmed }: {
  note: Note; snapshot: AdaptiveSnapshot; locale: PrivacyLocale; disabled: boolean;
  onSaved(snapshot: AdaptiveSnapshot): void; onRefresh(): void;
  onPendingChange?(token: string, pending: boolean): boolean;
  onUnconfirmed?(space: AdaptiveSpace): void;
}) {
  const fa = locale === 'fa', t = (en: string, persian: string) => fa ? persian : en, labelId = useId();
  const [stage, setStage] = useState<'closed' | 'edit' | 'review'>('closed');
  const [text, setText] = useState(''), [prepared, setPrepared] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement | null>(null), reviewRef = useRef<HTMLHeadingElement | null>(null);
  const diagnostics = useRef<AbortController | null>(null);
  const generation = useRef(0), request = useRef<PendingSave | null>(null);
  const invalidate = useCallback(() => {
    generation.current++; diagnostics.current?.abort(); diagnostics.current = null;
    const pending = request.current; request.current = null;
    if (pending) { clearTimeout(pending.timer); pending.controller.abort(); pending.release(); }
  }, []);
  const clear = () => { if (request.current) return; invalidate(); setStage('closed'); setText(''); setPrepared(''); setBusy(false); setError(false); };
  useLayoutEffect(() => {
    invalidate(); setStage('closed'); setText(''); setPrepared(''); setBusy(false); setError(false);
    return invalidate;
  }, [invalidate, snapshot.space, snapshot.identity.accountId, snapshot.identity.personId, snapshot.identity.confirmed, snapshot.identity.bindingId, snapshot.identity.bindingRevision, snapshot.memoryCorrectionAvailable, snapshot.explicitMemoryValidUntil, note.id, note.revision, note.text, locale, disabled]);
  const analytics = snapshot.purposes.find(p => p.purpose === 'optional.product_analytics');
  useLayoutEffect(() => { return () => { diagnostics.current?.abort(); }; }, [analytics?.revision, analytics?.state, analytics?.available]);
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
    if (!allowed || busy || request.current || stage !== 'review' || !prepared || error) return;
    const epoch = generation.current, controller = new AbortController(), eventId = crypto.randomUUID();
    if (onPendingChange?.(eventId, true) === false) return;
    const session = tg()?.initData ?? '', diagnosticController = new AbortController(); diagnostics.current?.abort(); diagnostics.current = diagnosticController;
    // Optional receipt acquisition runs alongside Save and never delays it.
    const authority = analytics?.state === 'granted' && analytics.available
      ? (async () => learningApi.correctionAuthority(snapshot.space, diagnosticController.signal))().catch(() => null) : Promise.resolve(null);
    const report = (outcome: 'correction_client_saved' | 'correction_client_unconfirmed') => {
      void authority.then(receipt => {
        if (!receipt?.policyReceipt || diagnosticController.signal.aborted || epoch !== generation.current || (tg()?.initData ?? '') !== session) return;
        return learningApi.correction({ version: 1, eventId, space: snapshot.space, policyReceipt: receipt.policyReceipt, outcome });
      }).catch(() => undefined);
    };
    let confirmed = false, released = false;
    const pending: PendingSave = { controller, release: () => {
      if (released) return; released = true;
      if (!confirmed) onUnconfirmed?.(snapshot.space);
      onPendingChange?.(eventId, false);
    } };
    request.current = pending; setBusy(true); setError(false);
    try {
      const timeout = new Promise<never>((_, reject) => {
        controller.signal.addEventListener('abort', () => reject(new Error('correction_outcome_unknown')), { once: true });
        pending.timer = setTimeout(() => controller.abort(), MEMORY_CORRECTION_SAVE_TIMEOUT_MS);
      });
      const result = await Promise.race([adaptiveApi.correct(note.id, { space: snapshot.space, text: prepared, expectedRevision: note.revision, eventId }, controller.signal, locale), timeout]);
      if (controller.signal.aborted || epoch !== generation.current) return;
      if (result.space !== snapshot.space) throw new Error('correction_scope_changed');
      report('correction_client_saved');
      confirmed = true; setStage('closed'); setText(''); setPrepared(''); onSaved(result);
    } catch { if (epoch === generation.current) { report('correction_client_unconfirmed'); setError(true); } }
    finally { clearTimeout(pending.timer); if (request.current === pending) request.current = null; pending.release(); if (epoch === generation.current) setBusy(false); }
  };
  if (stage === 'closed') return <button className="vx-btn vx-btn-secondary vx-btn-sm" disabled={!allowed} onClick={() => { if (request.current) return; setText(note.text); setPrepared(''); setError(false); setStage('edit'); }}>{t('Edit note', 'ویرایش یادداشت')}</button>;
  return <section aria-label={t('Correct private note', 'اصلاح یادداشت خصوصی')} dir={fa ? 'rtl' : 'ltr'} lang={locale} aria-busy={busy}>
    <p className="vx-small">{t('Private to you', 'خصوصی برای شما')} · {snapshot.space === 'work' ? t('Work', 'کاری') : t('Personal', 'شخصی')}</p>
    <p className="vx-small">{t('Saving replaces this note and removes summaries that depend on its old version. Its original expiry and sharing permissions stay the same.', 'ذخیره، این یادداشت را جایگزین و خلاصه‌های وابسته به نسخهٔ قبلی را حذف می‌کند. مهلت اصلی و مجوزهای اشتراک آن تغییر نمی‌کنند.')}</p>
    {stage === 'edit' ? <>
      <label className="vx-small" htmlFor={labelId}>{t('Corrected note', 'یادداشت اصلاح‌شده')}</label>
      <textarea ref={inputRef} id={labelId} className="vx-textarea" value={text} rows={3} maxLength={2000} disabled={busy || !allowed} onChange={event => setText(event.target.value)} />
      <button className="vx-btn vx-btn-secondary vx-btn-sm" disabled={!allowed || busy || !text.trim() || text.trim() === note.text} onClick={() => { if (request.current) return; setPrepared(text.trim()); setStage('review'); }}>{t('Review correction', 'بررسی اصلاح')}</button>
    </> : <>
      <h4 ref={reviewRef} tabIndex={-1}>{t('Before', 'پیش از اصلاح')}</h4><p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{note.text}</p>
      <h4>{t('After saving', 'پس از ذخیره')}</h4><p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{prepared}</p>
      <button className="vx-btn vx-btn-secondary vx-btn-sm" disabled={!allowed || busy || error} onClick={() => void save()}>{t('Save correction', 'ذخیرهٔ اصلاح')}</button>
      <button className="vx-btn vx-btn-secondary vx-btn-sm" disabled={busy || error} onClick={() => { if (request.current) return; setStage('edit'); setPrepared(''); setError(false); }}>{t('Back to edit', 'بازگشت به ویرایش')}</button>
    </>}
    <button className="vx-btn vx-btn-secondary vx-btn-sm" disabled={busy || error} onClick={clear}>{t('Cancel', 'انصراف')}</button>
    {busy && <div role="status" aria-live="polite"><p>{snapshot.space === 'work' ? t('Saving in Work…', 'در حال ذخیره در فضای کاری…') : t('Saving in Personal…', 'در حال ذخیره در فضای شخصی…')}</p><p className="vx-small">{t('Please wait for the result. Closing the app may not stop this save; reopen Privacy and refresh notes to check.', 'لطفاً منتظر نتیجه بمانید. بستن برنامه ممکن است ذخیره را متوقف نکند؛ برای بررسی، حریم خصوصی را دوباره باز و یادداشت‌ها را تازه‌سازی کنید.')}</p></div>}
    {error && <div role="alert"><p>{snapshot.space === 'work' ? t('The correction may have been saved in Work. Refresh notes to check before editing again.', 'ممکن است اصلاح در فضای کاری ذخیره شده باشد. پیش از ویرایش دوباره، یادداشت‌ها را تازه‌سازی و بررسی کنید.') : t('The correction may have been saved in Personal. Refresh notes to check before editing again.', 'ممکن است اصلاح در فضای شخصی ذخیره شده باشد. پیش از ویرایش دوباره، یادداشت‌ها را تازه‌سازی و بررسی کنید.')}</p>
      <button className="vx-btn vx-btn-secondary vx-btn-sm" onClick={() => { clear(); onRefresh(); }}>{t('Refresh notes', 'تازه‌سازی یادداشت‌ها')}</button></div>}
  </section>;
}
