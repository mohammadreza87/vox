'use client';
import { useEffect, useRef, useState } from 'react';
import { learningApi, type LearningSpace, type ObserverSnapshot, type LearningOperations } from '../_lib/learning-client';

/** Personal evidence only. Operations and cross-account improvement reports have separate access. */
export function LearningPanel({ space, locale = 'en', showOperations = false }: { space: LearningSpace; locale?: 'en' | 'fa'; showOperations?: boolean }) {
  const fa = locale === 'fa';
  const t = (en: string, persian: string) => fa ? persian : en;
  const [snapshot, setSnapshot] = useState<ObserverSnapshot | null>(null);
  const [busy, setBusy] = useState<'load' | 'refresh' | 'export' | null>('load');
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const generation = useRef(0);
  const lock = useRef(false);
  useEffect(() => {
    const current = ++generation.current;
    lock.current = true; setSnapshot(null); setBusy('load'); setError(''); setStatus('');
    learningApi.read(space).then(value => {
      if (current !== generation.current) return;
      if (value.space !== space) throw new Error('Unexpected space');
      setSnapshot(value);
    }).catch(() => { if (current === generation.current) setError('load'); })
      .finally(() => { if (current === generation.current) { lock.current = false; setBusy(null); } });
    return () => { generation.current = current + 1; };
  }, [space]);
  const run = async (action: 'refresh' | 'export') => {
    if (lock.current) return;
    const current = generation.current;
    lock.current = true; setBusy(action); setError(''); setStatus('');
    try {
      if (action === 'refresh') {
        const value = await learningApi.process(space);
        if (current !== generation.current) return;
        if (value.space !== space) throw new Error('Unexpected space');
        setSnapshot(value); setStatus('refreshed');
      } else {
        const value = await learningApi.export(space);
        if (current !== generation.current) return;
        const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
        try {
          const link = document.createElement('a');
          link.href = url; link.download = `vox-learning-${space}.json`; link.click();
        } finally { URL.revokeObjectURL(url); }
        setStatus('exported');
      }
    } catch { if (current === generation.current) setError(action); }
    finally { if (current === generation.current) { lock.current = false; setBusy(null); } }
  };
  // A prop change must hide the previous space before its effect starts.
  const data = snapshot?.space === space ? snapshot : null;
  const available = data?.available === true;
  const number = (value: number | null | undefined) => available && value != null ? value.toLocaleString(fa ? 'fa-IR' : 'en-US') : t('Unavailable', 'در دسترس نیست');
  const p = data?.projection;
  const metrics = [
    [t('Responses completed', 'پاسخ‌های کامل‌شده'), number(p?.responded)],
    [t('Response failures', 'پاسخ‌های ناموفق'), number(p?.failed)],
    [t('Playback completed', 'پخش‌های کامل‌شده'), number(p?.playbackCompleted)],
    [t('Playback failures', 'پخش‌های ناموفق'), number(p?.playbackFailed)],
  ];
  const stageCopy = { stt: t('Listening', 'شنیدن'), retrieval: t('Memory lookup', 'بازیابی حافظه'), decisions: t('Preparation', 'آماده‌سازی'), generation: t('Writing a response', 'نوشتن پاسخ'), tts: t('Preparing speech', 'آماده‌سازی گفتار') };
  const findingCopy = {
    response_failure: t('Some responses were reported as failed by the server.', 'سرور ناموفق بودن برخی پاسخ‌ها را گزارش کرده است.'),
    playback_failure: t('Playback failures were reported by the client.', 'برخی خطاهای پخش از سوی مرورگر گزارش شده‌اند.'),
    interruption: t('Interrupted playback was reported by the client.', 'قطع شدن پخش از سوی مرورگر گزارش شده است.'),
  };
  return <><section className="vx-card vx-privacy-card" aria-label={t('Learning evidence', 'شواهد یادگیری')} aria-busy={!!busy} dir={fa ? 'rtl' : 'ltr'} lang={locale}
    style={{ background: 'linear-gradient(145deg, var(--s1), var(--ground))', gap: 18 }}>
    <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'space-between', gap: 10 }}>
      <h2 className="vx-head">{t('Learning evidence', 'شواهد یادگیری')}</h2>
      <span className="vx-small" style={{ border: '1px solid var(--hair)', borderRadius: 24, padding: '5px 10px', color: 'var(--volt)' }}>{space === 'work' ? t('Your Work space', 'فضای کاری شما') : t('Your Personal space', 'فضای شخصی شما')}</span>
    </div>
    <p className="vx-small vx-2">{t('See the measurements behind your experience. These observations describe recorded behavior; they do not explain why it happened.', 'اندازه‌گیری‌های تجربهٔ خود را ببینید. این مشاهدات رفتار ثبت‌شده را نشان می‌دهند؛ علت آن را توضیح نمی‌دهند.')}</p>
    {busy === 'load' && <p role="status">{t('Loading your evidence…', 'در حال دریافت شواهد شما…')}</p>}
    {data && <>
      {!available && <p className="vx-small vx-2">{t('Optional usage analytics is off or unavailable. Measurements are unavailable.', 'تحلیل اختیاری استفاده خاموش است یا در دسترس نیست. اندازه‌گیری‌ها در دسترس نیستند.')}</p>}
      <dl style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10, margin: 0 }}>
        {metrics.map(([label, value]) => <div key={label} style={{ border: '1px solid var(--hair)', borderRadius: 16, padding: '14px 12px', minWidth: 0 }}><dt className="vx-small vx-2">{label}</dt><dd className="vx-num" style={{ margin: '8px 0 0', fontSize: available ? 28 : 14, overflowWrap: 'anywhere' }}>{value}</dd></div>)}
      </dl>
      <div className="vx-small vx-2" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <p>{t('Waiting to process', 'در انتظار پردازش')}: {number(data.queue.pending + data.queue.leased)} · {t('Processing failures', 'خطاهای پردازش')}: {number(data.queue.failed)}</p>
        <p>{t('Playback not reported', 'پخش گزارش‌نشده')}: {number(p?.playbackUnknown)} · {t('Interrupted playback', 'پخش قطع‌شده')}: {number(p?.interruptions)}</p>
        <p>{t('Average response time', 'میانگین زمان پاسخ')}: {available && p?.meanResponseMs != null ? `${Math.round(p.meanResponseMs).toLocaleString(fa ? 'fa-IR' : 'en-US')} ${t('ms', 'میلی‌ثانیه')}` : t('Unavailable', 'در دسترس نیست')}</p>
        <p>{t('Client-reported time to playback', 'زمان پخش گزارش‌شدهٔ مرورگر')}: {number(p?.telemetry?.clientMeanTimeToPlaybackMs)} {t('ms', 'میلی‌ثانیه')}</p>
        <p>{t('Client-reported text displayed', 'نمایش متن گزارش‌شدهٔ مرورگر')}: {number(p?.clientExperience?.textRendered)} · {t('Time to text', 'زمان تا نمایش متن')}: {number(p?.clientExperience?.meanTimeToTextMs)} {t('ms', 'میلی‌ثانیه')}</p>
        <p>{t('Reported corrections saved / unconfirmed', 'اصلاح‌های ذخیره‌شده / تأییدنشدهٔ گزارش‌شده')}: {number(p?.clientExperience?.correctionSaved)} / {number(p?.clientExperience?.correctionUnconfirmed)}</p>
        <p>{t('Reported task success / failure', 'موفقیت / شکست گزارش‌شدهٔ کار')}: {number(p?.telemetry?.reportedTaskSucceeded)} / {number(p?.telemetry?.reportedTaskFailed)}</p>
        <p>{t('Provider input / output tokens observed', 'توکن‌های ورودی / خروجی مشاهده‌شدهٔ ارائه‌دهنده')}: {number(p?.telemetry?.inputTokens)} / {number(p?.telemetry?.outputTokens)}</p>
        <p>{t('Usage complete', 'کامل بودن مصرف')}: {p?.telemetry?.usageComplete ? t('Yes', 'بله') : t('No; missing usage is unknown', 'خیر؛ مصرف ثبت‌نشده نامشخص است')} · {t('Billed cost unavailable', 'هزینهٔ صورتحساب در دسترس نیست')}</p>
        {p?.telemetry?.stages.map(stage => <p key={stage.stage}>{stageCopy[stage.stage]}: {number(stage.meanMs)} {t('ms', 'میلی‌ثانیه')} ({number(stage.samples)} {t('samples', 'نمونه')})</p>)}
        <p>{t('Last measurement update', 'آخرین به‌روزرسانی اندازه‌گیری‌ها')}: {available && data.queue.lastProcessedAt != null ? new Date(data.queue.lastProcessedAt).toLocaleString(fa ? 'fa-IR' : 'en-US') : t('Unavailable', 'در دسترس نیست')}</p>
      </div>
      <div className="vx-privacy-note">
        <p className="vx-small">{t('Playback is client reported. Verified task success is unknown.', 'پخش توسط مرورگر گزارش شده است. موفقیت تأییدشدهٔ کار نامشخص است.')}</p>
        <p className="vx-small vx-2">{t('Coverage includes instrumented stages and returned provider usage only; partial or missing usage is unknown. Live provider audio and verified task outcomes are unavailable.', 'پوشش شامل مرحله‌های ثبت‌شده و مصرف بازگشتی ارائه‌دهنده است؛ مصرف ناقص یا ثبت‌نشده نامشخص است. صدای ارائه‌دهندهٔ زنده و نتیجهٔ تأییدشدهٔ کار در دسترس نیستند.')}</p>
        {available && data.findings.map(finding => <p className="vx-small" key={finding.rule}>{findingCopy[finding.rule]} <span className="vx-2">({number(finding.count)})</span></p>)}
        {available && !data.findings.length && <p className="vx-small vx-2">{t('No findings in the processed evidence yet.', 'هنوز یافته‌ای در شواهد پردازش‌شده وجود ندارد.')}</p>}
      </div>
    </>}
    {error && <div className="vx-banner danger" role="alert">{error === 'export' ? t('The export could not be downloaded. Try again.', 'بارگیری خروجی انجام نشد. دوباره تلاش کنید.') : t('Measurements could not be updated. Try again.', 'اندازه‌گیری‌ها به‌روز نشدند. دوباره تلاش کنید.')}</div>}
    {status && <p className="vx-small" role="status">{status === 'exported' ? t('Your JSON download is ready.', 'بارگیری JSON شما آماده است.') : t('Measurements refreshed. Some events may still be waiting.', 'اندازه‌گیری‌ها تازه شدند. ممکن است برخی رویدادها هنوز در انتظار باشند.')}</p>}
    <div className="vx-privacy-actions vx-learning-actions">
      <button className="vx-btn vx-btn-secondary" disabled={!!busy} onClick={() => void run('refresh')}>{busy === 'refresh' ? t('Refreshing…', 'در حال تازه‌سازی…') : error && error !== 'export' ? t('Retry measurements', 'تلاش دوباره برای اندازه‌گیری‌ها') : t('Refresh measurements', 'تازه‌سازی اندازه‌گیری‌ها')}</button>
      <button className="vx-btn vx-btn-secondary" disabled={!!busy} onClick={() => void run('export')}>{busy === 'export' ? t('Preparing…', 'در حال آماده‌سازی…') : t('Export my learning data', 'دریافت داده‌های یادگیری من')}</button>
    </div>
    <p className="vx-small vx-2">{t('Refresh updates a small batch of measurements. Export downloads your saved preferences, memories and measurements for this space.', 'تازه‌سازی، دستهٔ کوچکی از اندازه‌گیری‌ها را به‌روز می‌کند. خروجی، ترجیح‌ها، حافظه‌ها و اندازه‌گیری‌های ذخیره‌شدهٔ شما در این فضا را دریافت می‌کند.')}</p>
  </section>{showOperations && <OperationsPanel locale={locale} />}</>;
}


function OperationsPanel({ locale }: { locale: 'en' | 'fa' }) {
  const t = (en: string, fa: string) => locale === 'fa' ? fa : en;
  const [data, setData] = useState<LearningOperations | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState(false);
  const generation = useRef(0);
  const load = async () => {
    const current = ++generation.current;
    setBusy(true); setError(false); setData(null);
    try { const value = await learningApi.operations(); if (generation.current === current) setData(value); }
    catch { if (generation.current === current) setError(true); }
    finally { if (generation.current === current) setBusy(false); }
  };
  useEffect(() => {
    void load();
    const current = generation.current;
    return () => { generation.current = current + 1; };
  }, []);
  const report = data?.report;
  const configured = (value: boolean) => value ? t('Configured', 'پیکربندی شده') : t('Not configured', 'پیکربندی نشده');
  return <section className="vx-card vx-privacy-card" aria-label={t('Software improvement operations', 'عملیات بهبود نرم‌افزار')} aria-busy={busy} dir={locale === 'fa' ? 'rtl' : 'ltr'} lang={locale}>
    <h2 className="vx-head">{t('Software improvement', 'بهبود نرم‌افزار')}</h2>
    <p className="vx-small vx-2">{t('Operator view · Local workflow evidence. Configuration does not prove a scheduled run or a production change.', 'نمای اپراتور · شواهد روند محلی. پیکربندی به معنی اجرای زمان‌بندی‌شده یا تغییر محیط عملیاتی نیست.')}</p>
    {busy && <p role="status">{t('Loading operations…', 'در حال دریافت عملیات…')}</p>}
    {error && <p role="alert">{t('Operations evidence is unavailable.', 'شواهد عملیات در دسترس نیست.')}</p>}
    {data && <>
      <p className="vx-small">{t('Maintenance', 'نگهداری')}: {configured(data.maintenanceConfigured)} · {t('Improvement workflow', 'روند بهبود')}: {configured(data.improvementConfigured)}</p>
      {report ? <>
        <p className="vx-small">{t('Audit events', 'رویدادهای ممیزی')}: {report.auditEvents.toLocaleString(locale === 'fa' ? 'fa-IR' : 'en-US')} · {t('Candidates', 'نامزدها')}: {report.candidates.length.toLocaleString(locale === 'fa' ? 'fa-IR' : 'en-US')}</p>
        <p className="vx-small">{t('Evaluations passed', 'ارزیابی‌های پذیرفته‌شده')}: {report.candidates.filter(c => c.evaluationStatus === 'passed').length.toLocaleString(locale === 'fa' ? 'fa-IR' : 'en-US')} · {t('Signed approvals', 'تأییدهای امضاشده')}: {report.candidates.filter(c => c.humanDecision === 'approve').length.toLocaleString(locale === 'fa' ? 'fa-IR' : 'en-US')}</p>
      </> : <p className="vx-small">{t('Local workflow report: unavailable.', 'گزارش روند محلی: در دسترس نیست.')}</p>}
    </>}
    <p className="vx-small vx-2">{t('CI, deployment, production impact and cost: unavailable. Proposed causes remain hypotheses.', 'CI، استقرار، اثر عملیاتی و هزینه: در دسترس نیست. علت‌های پیشنهادی همچنان فرضیه هستند.')}</p>
    <button className="vx-btn vx-btn-secondary" disabled={busy} onClick={() => void load()}>{t('Refresh operations', 'تازه‌سازی عملیات')}</button>
  </section>;
}
