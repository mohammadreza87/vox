'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { VoiceScope } from '@/lib/adaptive/voice-identity/contracts';
import { voiceIdentityApi, voiceDeviceId, captureVoiceSample, type VoiceIdentitySnapshot } from '../_lib/voice-identity-client';
import { adaptiveApi } from '../_lib/adaptive-client';

export function VoiceRecognitionPanel({ space, locale = 'en' }: { space: 'work' | 'personal'; locale?: 'en' | 'fa' }) {
  const [data, setData] = useState<VoiceIdentitySnapshot | null>(null);
  const [scope, setScope] = useState<VoiceScope | null>(null);
  const [selfOnly, setSelfOnly] = useState(false);
  const [busy, setBusy] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [challenge, setChallenge] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const generation = useRef(0), controller = useRef<AbortController | null>(null);
  const fa = locale === 'fa';
  const t = (en: string, persian: string) => fa ? persian : en;
  const load = useCallback(async () => {
    const current = ++generation.current;
    controller.current?.abort(); setCapturing(false); setBusy(false); setData(null); setSelfOnly(false); setMessage(''); setError('');
    try {
      const nextScope = { space, deviceId: voiceDeviceId() }; setScope(nextScope);
      const result = await voiceIdentityApi.read(nextScope);
      if (current === generation.current) setData(result);
    } catch { if (current === generation.current) setError(locale === 'fa' ? 'وضعیت تشخیص صدا دریافت نشد.' : 'Voice recognition status could not be loaded.'); }
  }, [space, locale]);
  const dispose = useCallback(() => { generation.current++; controller.current?.abort(); }, []);
  useEffect(() => { void load(); return dispose; }, [load, dispose]);
  const mutate = async (fn: () => Promise<VoiceIdentitySnapshot>) => {
    if (busy) return; const current = generation.current; setBusy(true); setError(''); setMessage('');
    try { const next = await fn(); if (current === generation.current) { setData(next); setSelfOnly(false); } }
    catch { if (current === generation.current) setError(t('The change was not confirmed. Refresh and try again.', 'تغییر تأیید نشد. صفحه را تازه کنید و دوباره تلاش کنید.')); }
    finally { if (current === generation.current) setBusy(false); }
  };
  const record = async (mode: 'enroll' | 'test') => {
    if (busy || !scope || !data || !selfOnly) return;
    const current = generation.current, abort = new AbortController(); controller.current = abort;
    setBusy(true); setError(''); setMessage('');
    try {
      let next = data;
      if (mode === 'enroll') {
        if (!data.receipt) throw new Error('enrollment_disclosure_required');
        next = await voiceIdentityApi.enroll(scope, data.revision, data.receipt);
      }
      if (current !== generation.current || abort.signal.aborted) return;
      next = await voiceIdentityApi.begin(scope, next.revision, mode);
      if (current !== generation.current || abort.signal.aborted) return;
      if (!next.capture) throw new Error('capture_unavailable');
      setData(next); setChallenge(next.capture.challenge); setCapturing(true);
      const audio = await captureVoiceSample(next.capture, abort.signal);
      if (current !== generation.current || abort.signal.aborted) return;
      setCapturing(false);
      const result = await voiceIdentityApi.sample(scope, next.capture.id, audio, abort.signal);
      if (current !== generation.current || abort.signal.aborted) return;
      setData(result.status); setSelfOnly(false);
      setMessage(mode === 'enroll' && result.status.enrollment === 'enrolled' ? t('Your enrollment is saved for this device session and space.', 'ثبت صدا برای این نشست دستگاه و این فضا ذخیره شد.') : result.hint?.outcome === 'possible_self' ? t('Possible match to your enrolled voice. Confirm the active profile in Privacy and memory before using private context.', 'احتمال شباهت به صدای ثبت‌شدهٔ شما وجود دارد. پیش از استفاده از زمینهٔ خصوصی، نمایهٔ فعال را در حریم خصوصی و حافظه تأیید کنید.') : t('No reliable hint. Use the authenticated profile controls.', 'نشانهٔ قابل اتکایی پیدا نشد. از کنترل‌های نمایهٔ احراز هویت‌شده استفاده کنید.'));
    } catch (e) {
      if (current === generation.current) setError(abort.signal.aborted ? t('Capture cancelled. Refresh to confirm the server enrollment status.', 'ضبط لغو شد. برای تأیید وضعیت ثبت صدا در سرور صفحه را تازه کنید.') : e instanceof DOMException && e.name === 'NotAllowedError' ? t('Microphone permission was denied. You can keep using text and ordinary calls.', 'مجوز میکروفون رد شد. می‌توانید از متن و تماس معمولی استفاده کنید.') : t('Capture was not completed. Refresh before trying again.', 'ضبط کامل نشد. پیش از تلاش دوباره صفحه را تازه کنید.'));
      if (current === generation.current) await voiceIdentityApi.cancel(scope).catch(() => undefined);
    } finally {
      if (current === generation.current) { setBusy(false); setCapturing(false); setChallenge(''); }
    }
  };
  const stopAndChange = async (fn: () => Promise<VoiceIdentitySnapshot>) => {
    controller.current?.abort();
    const current = ++generation.current; setBusy(true); setCapturing(false); setChallenge(''); setError(''); setMessage('');
    try { const next = await fn(); if (current === generation.current) { setData(next); setSelfOnly(false); } }
    catch { if (current === generation.current) setError(t('Recognition is stopped on this device. The server change is pending; refresh to retry.', 'تشخیص در این دستگاه متوقف شد. تغییر سرور در انتظار است؛ برای تلاش دوباره صفحه را تازه کنید.')); }
    finally { if (current === generation.current) setBusy(false); }
  };
  const cancel = () => {
    controller.current?.abort();
    if (scope) void voiceIdentityApi.cancel(scope).catch(() => undefined);
  };
  return <section className="vx-card vx-privacy-card" dir={fa ? 'rtl' : 'ltr'} lang={locale} aria-label={t('Optional voice recognition', 'تشخیص اختیاری صدا')} aria-busy={busy}>
    <h2 className="vx-head">{t('Optional voice recognition', 'تشخیص اختیاری صدا')}</h2>
    <p>{t('Recognition suggests a label for your own voice. It does not authenticate you or change private access. Voice cloning is separate. Text, ordinary calls and authenticated profile selection remain available.', 'تشخیص صدا فقط برچسبی برای صدای خودتان پیشنهاد می‌کند. این قابلیت شما را احراز هویت نمی‌کند و دسترسی خصوصی را تغییر نمی‌دهد. شبیه‌سازی صدا جداست. متن، تماس معمولی و انتخاب نمایهٔ احراز هویت‌شده همچنان در دسترس هستند.')}</p>
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    {!data && !error && <p role="status">{t('Loading…', 'در حال دریافت…')}</p>}
    {data && <>
      <p role="status">{data.available ? data.enrollment === 'enrolled' ? t('Enrolled on this device session in this space.', 'در این نشست دستگاه و این فضا ثبت شده است.') : t('No active enrollment on this device session in this space.', 'در این نشست دستگاه و این فضا ثبت فعال وجود ندارد.') : data.reason === 'biometric_consent_required' ? t('Review the separate Voice recognition choice in Privacy and memory first.', 'ابتدا انتخاب جداگانهٔ تشخیص صدا را در حریم خصوصی و حافظه بررسی کنید.') : t('Recognition is unavailable for this profile, region or provider. No recognition microphone capture is enabled.', 'تشخیص صدا برای این نمایه، منطقه یا ارائه‌دهنده در دسترس نیست. ضبط میکروفون برای تشخیص فعال نمی‌شود.')}</p>
      {data.deletion === 'provider_pending' && <p role="alert">{t('Recognition is blocked. Provider deletion is pending; retry deletion to check again.', 'تشخیص مسدود شده است. حذف نزد ارائه‌دهنده در انتظار است؛ برای بررسی دوباره، حذف را تکرار کنید.')}</p>}
      {data.deletion === 'online_completed' && <p>{t('Online template deletion completed. Backup expiry follows the operator’s reviewed policy.', 'حذف الگوی آنلاین کامل شد. انقضای پشتیبان‌ها تابع سیاست بررسی‌شدهٔ بهره‌بردار است.')}</p>}
      {data.notice && <div><h3>{data.notice.title}</h3><p>{data.notice.body}</p></div>}
      {data.available && data.enrollment !== 'purge_pending' && <>
        {(data.receipt || data.enrollment === 'enrolled') && <label className="vx-privacy-checkbox"><input type="checkbox" checked={selfOnly} disabled={busy} onChange={e => setSelfOnly(e.target.checked)} />{t('Only I am present and speaking live. I want to use only my own voice; no recording or another person.', 'فقط خودم حضور دارم و زنده صحبت می‌کنم. فقط از صدای خودم استفاده می‌کنم، نه صدای ضبط‌شده یا فرد دیگر.')}</label>}
        {data.enrollment === 'none' && !data.receipt && <button className="vx-btn vx-btn-secondary" disabled={busy} onClick={() => void mutate(() => voiceIdentityApi.present(scope!, data.revision, locale))}>{t('Review enrollment', 'بررسی ثبت صدا')}</button>}
        {data.enrollment === 'none' && data.receipt && <button className="vx-btn vx-btn-secondary" disabled={busy || !selfOnly} onClick={() => void record('enroll')}>{t('Enroll my voice', 'ثبت صدای من')}</button>}
        {data.enrollment === 'enrolled' && <button className="vx-btn vx-btn-secondary" disabled={busy || !selfOnly} onClick={() => void record('test')}>{t('Test my voice', 'آزمایش صدای من')}</button>}
      </>}
      {capturing && <div role="status"><p>{t('Recording for up to 10 seconds. Read these numbers aloud:', 'ضبط تا ۱۰ ثانیه. این اعداد را بلند بخوانید:')} <strong dir="ltr">{challenge}</strong></p><button className="vx-btn vx-btn-secondary" onClick={cancel}>{t('Cancel capture', 'لغو ضبط')}</button></div>}
      <p>{t('Deleting enrollment turns recognition off and deletes enrolled templates on every device in this space. Re-enrollment requires a new separate choice.', 'حذف ثبت صدا، تشخیص را خاموش می‌کند و الگوهای ثبت‌شده را از همهٔ دستگاه‌های این فضا حذف می‌کند. ثبت دوباره به انتخاب جداگانهٔ جدید نیاز دارد.')}</p>
      <div className="vx-privacy-actions"><button className="vx-btn vx-btn-secondary" disabled={busy} onClick={() => void load()}>{t('Refresh', 'تازه‌سازی')}</button>
        <button className="vx-btn vx-btn-secondary" disabled={!scope} onClick={() => { void stopAndChange(() => voiceIdentityApi.remove(scope!)); }}>{t('Delete enrollment in this space', 'حذف ثبت صدا در این فضا')}</button>
        {data.consent === 'granted' && <button className="vx-btn vx-btn-secondary" onClick={() => { void stopAndChange(async () => {
          const privacy = await adaptiveApi.read(space, locale), permission = privacy.purposes.find(p => p.purpose === 'optional.biometric_recognition')!;
          await adaptiveApi.consent(space, permission.purpose, permission.revision, 'withdrawn');
          return voiceIdentityApi.read(scope!);
        }); }}>{t('Turn recognition off in this space', 'خاموش کردن تشخیص در این فضا')}</button>}
      </div>
    </>}
  </section>;
}
