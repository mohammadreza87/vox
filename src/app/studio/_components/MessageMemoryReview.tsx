'use client';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { adaptiveApi } from '../_lib/adaptive-client';
import type { MessageMemoryPreview } from '@/lib/adaptive/message-memory/contracts';

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
    } catch { if (epoch.current === current && !abort.signal.aborted) setError(t('This review could not be confirmed. Check Privacy and agent access, then request a new preview.', 'این بررسی تأیید نشد. حریم خصوصی و دسترسی عامل را بررسی کنید و پیش‌نمایش تازه بخواهید.')); }
    finally { if (epoch.current === current) { setBusy(false); setSaving(false); } }
  };
  const expired = !!preview && preview.expiresAt <= now;
  return <section className="vx-card vx-privacy-card" aria-label={t('Review this message for private memory', 'بررسی این پیام برای حافظهٔ خصوصی')} aria-busy={busy} dir={locale === 'fa' ? 'rtl' : 'ltr'}>
    <h3 className="vx-head">{t('Review memory from this text', 'بررسی حافظه از این متن')}</h3>
    <p className="vx-small">{space === 'work' ? t('Work · Private to you', 'کاری · فقط برای شما') : t('Personal · Private to you', 'شخصی · فقط برای شما')}</p>
    <p className="vx-small">{t('Preview sends only the selected text below to this agent’s AI provider. The source text and draft are temporary. Nothing is saved until you choose Save reviewed claims. Claims are user-provided and are not proof of authorship or verified facts. This enables no automatic memory or sharing.', 'پیش‌نمایش فقط متن انتخاب‌شدهٔ زیر را به ارائه‌دهندهٔ هوش مصنوعی این عامل می‌فرستد. متن منبع و پیش‌نویس موقت‌اند. تا انتخاب «ذخیرهٔ ادعاهای بررسی‌شده»، چیزی ذخیره نمی‌شود. این ادعاهای ارائه‌شدهٔ کاربر، اثبات نویسندگی یا واقعیتِ تأییدشده نیستند. حافظهٔ خودکار یا اشتراک‌گذاری فعال نمی‌شود.')}</p>
    <blockquote aria-label={t('Exact selected text', 'متن دقیق انتخاب‌شده')} style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{text}</blockquote>
    <button className="vx-btn vx-btn-secondary" disabled={busy || disabled || !text.trim() || text.length > 4096} onClick={() => void run(false)}>{t('Preview private claims', 'پیش‌نمایش ادعاهای خصوصی')}</button>
    {preview && <div aria-label={t('Temporary claim preview', 'پیش‌نمایش موقت ادعاها')}>
      <p className="vx-small">{t('Check attribution, dates and uncertainty. Saved claims expire after 90 days; inspect or delete them in Privacy.', 'انتساب، تاریخ‌ها و عدم قطعیت را بررسی کنید. ادعاهای ذخیره‌شده پس از ۹۰ روز منقضی می‌شوند؛ آن‌ها را در حریم خصوصی ببینید یا حذف کنید.')}</p>
      {preview.claims.length ? <ol>{preview.claims.map((claim, index) => <li key={index} style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{claim}</li>)}</ol> : <p role="status">{t('No supported memory claim was proposed. Nothing was saved.', 'ادعای پشتیبانی‌شده‌ای برای حافظه پیشنهاد نشد. چیزی ذخیره نشد.')}</p>}
      {expired && <p role="status">{t('This preview expired. Request a new one.', 'این پیش‌نمایش منقضی شد. پیش‌نمایش تازه بخواهید.')}</p>}
      {preview.claims.length > 0 && <button className="vx-btn vx-btn-secondary" disabled={busy || disabled || expired} onClick={() => void run(true)}>{t('Save reviewed claims', 'ذخیرهٔ ادعاهای بررسی‌شده')}</button>}
    </div>}
    {saving && <p className="vx-small">{t('Closing cancels pending work. A save already completed must be deleted in Privacy.', 'بستن، کار در انتظار را لغو می‌کند. اگر ذخیره قبلاً کامل شده، باید آن را در حریم خصوصی حذف کنید.')}</p>}
    <button className="vx-btn vx-btn-secondary" onClick={close}>{saving ? t('Stop waiting and close', 'پایان انتظار و بستن') : t('Discard and close', 'کنارگذاشتن و بستن')}</button>
    {error && <p role="alert">{error}</p>}
  </section>;
}
