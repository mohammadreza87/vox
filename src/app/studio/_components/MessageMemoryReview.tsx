'use client';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { adaptiveApi } from '../_lib/adaptive-client';
import type { MessageMemoryPreview } from '@/lib/adaptive/message-memory/contracts';
import { Icon, SheetHead, Spinner } from './ui';

/** Explicit selected text only. This component never consumes predictions,
 * assistant text, images, audio or an automatically collected transcript. */
export function MessageMemoryReview({ text, agentId, space, locale, disabled, onClose, onSaved }: {
  text: string; agentId: string; space: 'work' | 'personal'; locale: 'en' | 'fa'; disabled: boolean;
  onClose: () => void; onSaved: (count: number) => void;
}) {
  const [preview, setPreview] = useState<MessageMemoryPreview | null>(null), [busy, setBusy] = useState(false), [saving, setSaving] = useState(false), [error, setError] = useState('');
  const [now, setNow] = useState(Date.now());
  const epoch = useRef(0), controller = useRef<AbortController | null>(null);
  const t = (en: string, fa: string) => locale === 'fa' ? fa : en;
  useLayoutEffect(() => {
    epoch.current++; controller.current?.abort(); setPreview(null); setBusy(false); setSaving(false); setError('');
    // Cleanup invalidates the live request epoch, not a captured old value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return () => { epoch.current++; controller.current?.abort(); };
  }, [text, agentId, space, locale, disabled]);
  useEffect(() => { if (!preview) return; const timer = setInterval(() => setNow(Date.now()), 500); return () => clearInterval(timer); }, [preview]);
  const close = () => { epoch.current++; controller.current?.abort(); setPreview(null); onClose(); };
  const run = async (save: boolean) => {
    if (disabled || busy || !text.trim() || text.length > 4096 || (save && (!preview?.claims.length || preview.expiresAt <= Date.now()))) return;
    const current = ++epoch.current, abort = new AbortController(); controller.current?.abort(); controller.current = abort;
    setBusy(true); setSaving(save); setError('');
    try {
      if (save && preview) {
        const result = await adaptiveApi.messageAccept({ space, agentId, claims: preview.claims, sourceTextHash: preview.sourceTextHash, receipt: preview.receipt }, abort.signal);
        if (epoch.current !== current || abort.signal.aborted) return;
        setPreview(null); onSaved(result.memoryIds.length);
      } else {
        const result = await adaptiveApi.messagePreview({ space, agentId, locale, text }, abort.signal);
        if (epoch.current !== current || abort.signal.aborted) return;
        setNow(Date.now()); setPreview(result);
      }
    } catch { if (epoch.current === current && !abort.signal.aborted) setError(t('This review could not be confirmed. Check your settings and agent access in You, then request a new preview.', 'این بررسی تأیید نشد. تنظیمات و دسترسی عامل را در بخش «شما» بررسی کنید و پیش‌نمایش تازه بخواهید.')); }
    finally { if (epoch.current === current) { setBusy(false); setSaving(false); } }
  };
  const expired = !!preview && preview.expiresAt <= now;
  return <section className="vx-sheet-stack vx-remember" aria-label={t('Review this message for private memory', 'بررسی این پیام برای حافظهٔ خصوصی')} aria-busy={busy} dir={locale === 'fa' ? 'rtl' : 'ltr'}>
    <SheetHead title={t('Remember this', 'به خاطر سپردن')} sub={space === 'work' ? t('Work · Private to you', 'کاری · فقط برای شما') : t('Personal · Private to you', 'شخصی · فقط برای شما')} />
    <blockquote className="vx-remember-quote" dir="auto" aria-label={t('Exact selected text', 'متن دقیق انتخاب‌شده')}>{text}</blockquote>
    <p className="vx-footnote">{t('Preview sends only the selected text below to this agent’s AI provider. The source text and draft are temporary. Nothing is saved until you choose Save reviewed claims. Claims are user-provided and are not proof of authorship or verified facts. This enables no automatic memory or sharing.', 'پیش‌نمایش فقط متن انتخاب‌شدهٔ زیر را به ارائه‌دهندهٔ هوش مصنوعی این عامل می‌فرستد. متن منبع و پیش‌نویس موقت‌اند. تا انتخاب «ذخیرهٔ ادعاهای بررسی‌شده»، چیزی ذخیره نمی‌شود. این ادعاهای ارائه‌شدهٔ کاربر، اثبات نویسندگی یا واقعیتِ تأییدشده نیستند. حافظهٔ خودکار یا اشتراک‌گذاری فعال نمی‌شود.')}</p>
    {preview && <div className="vx-remember-preview" aria-label={t('Temporary claim preview', 'پیش‌نمایش موقت ادعاها')}>
      {preview.claims.length ? <ol className="vx-group vx-remember-claims">{preview.claims.map((claim, index) => <li key={index} className="vx-row" dir="auto">{claim}</li>)}</ol>
        : <p className="vx-small vx-2" role="status">{t('No supported memory claim was proposed. Nothing was saved.', 'ادعای پشتیبانی‌شده‌ای برای حافظه پیشنهاد نشد. چیزی ذخیره نشد.')}</p>}
      <p className="vx-footnote">{t('Check attribution, dates and uncertainty. Saved claims expire after 90 days; inspect or delete them in You.', 'انتساب، تاریخ‌ها و عدم قطعیت را بررسی کنید. ادعاهای ذخیره‌شده پس از ۹۰ روز منقضی می‌شوند؛ آن‌ها را در بخش «شما» ببینید یا حذف کنید.')}</p>
      {expired && <p className="vx-small" role="status">{t('This preview expired. Request a new one.', 'این پیش‌نمایش منقضی شد. پیش‌نمایش تازه بخواهید.')}</p>}
    </div>}
    {error && <div className="vx-banner danger"><Icon name="warn" size={18} /><div className="vx-banner-body"><span role="alert">{error}</span></div></div>}
    {saving && <p className="vx-footnote">{t('Closing cancels pending work. A save already completed must be deleted in You.', 'بستن، کار در انتظار را لغو می‌کند. اگر ذخیره قبلاً کامل شده، باید آن را در بخش «شما» حذف کنید.')}</p>}
    <div className="vx-remember-actions">
      {preview && preview.claims.length > 0
        ? <button className="vx-btn vx-btn-primary vx-btn-block" disabled={busy || disabled || expired} onClick={() => void run(true)}>{saving ? <Spinner /> : null}{t('Save reviewed claims', 'ذخیرهٔ ادعاهای بررسی‌شده')}</button>
        : null}
      <button className={`vx-btn vx-btn-block ${preview?.claims.length ? 'vx-btn-ghost' : 'vx-btn-secondary'}`} disabled={busy || disabled || !text.trim() || text.length > 4096} onClick={() => void run(false)}>
        {busy && !saving ? <Spinner /> : null}{t('Preview private claims', 'پیش‌نمایش ادعاهای خصوصی')}</button>
      <button className="vx-btn vx-btn-ghost vx-btn-sm" onClick={close}>{saving ? t('Stop waiting and close', 'پایان انتظار و بستن') : t('Discard and close', 'کنارگذاشتن و بستن')}</button>
    </div>
  </section>;
}
