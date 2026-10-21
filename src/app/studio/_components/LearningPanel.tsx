'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { learningApi, type LearningSpace, type ObserverSnapshot, type LearningOperations } from '../_lib/learning-client';
import { MaintenanceHealthPanel } from './MaintenanceHealthPanel';
import { Fact, IconTile } from './screens/settings/kit';
import { Banner, Icon, Row, SkeletonRows, Spinner, Stat, Stats } from './ui';

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
  const ms = (value: number | null | undefined) => available && value != null ? `${Math.round(value).toLocaleString(fa ? 'fa-IR' : 'en-US')} ${t('ms', 'میلی‌ثانیه')}` : t('Unavailable', 'در دسترس نیست');
  const pair = (a: number | null | undefined, b: number | null | undefined) => `${number(a)} / ${number(b)}`;
  const details: Array<[string, string]> = data ? [
    [t('Waiting to process', 'در انتظار پردازش'), number(data.queue.pending + data.queue.leased)],
    [t('Processing failures', 'خطاهای پردازش'), number(data.queue.failed)],
    [t('Playback not reported', 'پخش گزارش‌نشده'), number(p?.playbackUnknown)],
    [t('Interrupted playback', 'پخش قطع‌شده'), number(p?.interruptions)],
    [t('Average response time', 'میانگین زمان پاسخ'), ms(p?.meanResponseMs)],
    [t('Client-reported time to playback', 'زمان پخش گزارش‌شدهٔ مرورگر'), ms(p?.telemetry?.clientMeanTimeToPlaybackMs)],
    [t('Client-reported text displayed', 'نمایش متن گزارش‌شدهٔ مرورگر'), number(p?.clientExperience?.textRendered)],
    [t('Time to text', 'زمان تا نمایش متن'), ms(p?.clientExperience?.meanTimeToTextMs)],
    [t('Reported corrections saved / unconfirmed', 'اصلاح‌های ذخیره‌شده / تأییدنشدهٔ گزارش‌شده'), pair(p?.clientExperience?.correctionSaved, p?.clientExperience?.correctionUnconfirmed)],
    [t('Reported task success / failure', 'موفقیت / شکست گزارش‌شدهٔ کار'), pair(p?.telemetry?.reportedTaskSucceeded, p?.telemetry?.reportedTaskFailed)],
    [t('Provider input / output tokens observed', 'توکن‌های ورودی / خروجی مشاهده‌شدهٔ ارائه‌دهنده'), pair(p?.telemetry?.inputTokens, p?.telemetry?.outputTokens)],
    [t('Usage complete', 'کامل بودن مصرف'), p?.telemetry?.usageComplete ? t('Yes', 'بله') : t('No; missing usage is unknown', 'خیر؛ مصرف ثبت‌نشده نامشخص است')],
    [t('Billed cost', 'هزینهٔ صورتحساب'), t('Unavailable', 'در دسترس نیست')],
    ...(p?.telemetry?.stages.map(stage => [`${stageCopy[stage.stage]} (${number(stage.samples)} ${t('samples', 'نمونه')})`, ms(stage.meanMs)] as [string, string]) ?? []),
    [t('Last measurement update', 'آخرین به‌روزرسانی اندازه‌گیری‌ها'), available && data.queue.lastProcessedAt != null ? new Date(data.queue.lastProcessedAt).toLocaleString(fa ? 'fa-IR' : 'en-US') : t('Unavailable', 'در دسترس نیست')],
  ] : [];
  return <><section className="vx-section vx-diag" aria-label={t('Learning evidence', 'شواهد یادگیری')} aria-busy={!!busy} dir={fa ? 'rtl' : 'ltr'} lang={locale}>
    <div className="vx-section-head">
      <h2 className="vx-over">{t('Learning evidence', 'شواهد یادگیری')}</h2>
      <span className="vx-pill volt">{space === 'work' ? t('Your Work space', 'فضای کاری شما') : t('Your Personal space', 'فضای شخصی شما')}</span>
    </div>
    <p className="vx-section-foot vx-diag-lede">{t('See the measurements behind your experience. These observations describe recorded behavior; they do not explain why it happened.', 'اندازه‌گیری‌های تجربهٔ خود را ببینید. این مشاهدات رفتار ثبت‌شده را نشان می‌دهند؛ علت آن را توضیح نمی‌دهند.')}</p>
    {busy === 'load' && <SkeletonRows rows={2} lead={false} label={t('Loading your evidence…', 'در حال دریافت شواهد شما…')} />}
    {data && <>
      {!available && <Banner tone="info">{t('Optional usage analytics is off or unavailable. Measurements are unavailable.', 'تحلیل اختیاری استفاده خاموش است یا در دسترس نیست. اندازه‌گیری‌ها در دسترس نیستند.')}</Banner>}
      <Stats>{metrics.map(([label, value]) => <Stat key={label} label={label} value={<span className={available ? undefined : 'vx-stat-na'}>{value}</span>} />)}</Stats>
      <div className="vx-group">{details.map(([label, value]) => <Fact key={label} label={label}>{value}</Fact>)}</div>
      <Banner tone="info">{t('Playback is client reported. Verified task success is unknown.', 'پخش توسط مرورگر گزارش شده است. موفقیت تأییدشدهٔ کار نامشخص است.')}</Banner>
      {available && data.findings.map(finding => <Banner key={finding.rule} tone="warn">{findingCopy[finding.rule]} <span className="vx-2">({number(finding.count)})</span></Banner>)}
      {available && !data.findings.length && <p className="vx-section-foot">{t('No findings in the processed evidence yet.', 'هنوز یافته‌ای در شواهد پردازش‌شده وجود ندارد.')}</p>}
      <p className="vx-section-foot">{t('Coverage includes instrumented stages and returned provider usage only; partial or missing usage is unknown. Live provider audio and verified task outcomes are unavailable.', 'پوشش شامل مرحله‌های ثبت‌شده و مصرف بازگشتی ارائه‌دهنده است؛ مصرف ناقص یا ثبت‌نشده نامشخص است. صدای ارائه‌دهندهٔ زنده و نتیجهٔ تأییدشدهٔ کار در دسترس نیستند.')}</p>
    </>}
    {error && <Banner tone="danger">{error === 'export' ? t('The export could not be downloaded. Try again.', 'بارگیری خروجی انجام نشد. دوباره تلاش کنید.') : t('Measurements could not be updated. Try again.', 'اندازه‌گیری‌ها به‌روز نشدند. دوباره تلاش کنید.')}</Banner>}
    {status && <Banner tone="success"><span role="status">{status === 'exported' ? t('Your JSON download is ready.', 'بارگیری JSON شما آماده است.') : t('Measurements refreshed. Some events may still be waiting.', 'اندازه‌گیری‌ها تازه شدند. ممکن است برخی رویدادها هنوز در انتظار باشند.')}</span></Banner>}
    <div className="vx-group">
      <Row plain lead={busy === 'refresh' ? <span className="vx-tile icon"><Spinner /></span> : <IconTile name="refresh" />} disabled={!!busy} onClick={() => void run('refresh')}
        title={busy === 'refresh' ? t('Refreshing…', 'در حال تازه‌سازی…') : error && error !== 'export' ? t('Retry measurements', 'تلاش دوباره برای اندازه‌گیری‌ها') : t('Refresh measurements', 'تازه‌سازی اندازه‌گیری‌ها')} />
      <Row plain lead={busy === 'export' ? <span className="vx-tile icon"><Spinner /></span> : <IconTile name="download" />} disabled={!!busy} onClick={() => void run('export')}
        title={busy === 'export' ? t('Preparing…', 'در حال آماده‌سازی…') : t('Export my learning data', 'دریافت داده‌های یادگیری من')} />
    </div>
    <p className="vx-section-foot">{t('Refresh updates a small batch of measurements. Export downloads your saved preferences, memories and measurements for this space.', 'تازه‌سازی، دستهٔ کوچکی از اندازه‌گیری‌ها را به‌روز می‌کند. خروجی، ترجیح‌ها، حافظه‌ها و اندازه‌گیری‌های ذخیره‌شدهٔ شما در این فضا را دریافت می‌کند.')}</p>
  </section>{showOperations && <OperationsPanel key={space} locale={locale} />}</>;
}


export function OperationsPanel({ locale }: { locale: 'en' | 'fa' }) {
  const t = (en: string, fa: string) => locale === 'fa' ? fa : en;
  const [data, setData] = useState<LearningOperations | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState(false);
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const lock = useRef(false);
  const load = useCallback(async () => {
    if (lock.current) return;
    const current = ++generation.current;
    const pending = new AbortController();
    controller.current?.abort(); controller.current = pending;
    lock.current = true;
    setBusy(true); setError(false); setData(null);
    try { const value = await learningApi.operations(pending.signal); if (generation.current === current && !pending.signal.aborted) setData(value); }
    catch { if (generation.current === current && !pending.signal.aborted) setError(true); }
    finally { if (generation.current === current) { lock.current = false; setBusy(false); } }
  }, []);
  const cancel = useCallback(() => { generation.current++; controller.current?.abort(); lock.current = false; }, []);
  useEffect(() => {
    void load();
    return cancel;
  }, [load, cancel]);
  const report = data?.report;
  const configured = (value: boolean) => value === true ? t('Configured', 'پیکربندی شده') : value === false ? t('Not configured', 'پیکربندی نشده') : t('Unavailable', 'در دسترس نیست');
  const n = (value: number) => value.toLocaleString(locale === 'fa' ? 'fa-IR' : 'en-US');
  return <section className="vx-section vx-diag" aria-label={t('Software improvement operations', 'عملیات بهبود نرم‌افزار')} aria-busy={busy} dir={locale === 'fa' ? 'rtl' : 'ltr'} lang={locale}>
    <div className="vx-section-head">
      <h2 className="vx-over">{t('Software improvement', 'بهبود نرم‌افزار')}</h2>
      <button type="button" className="vx-icon-btn" disabled={busy} onClick={() => void load()} aria-label={busy ? t('Loading operations…', 'در حال دریافت عملیات…') : t('Refresh operations', 'تازه‌سازی عملیات')}>
        {busy ? <Spinner /> : <Icon name="refresh" size={18} />}</button>
    </div>
    <p className="vx-section-foot vx-diag-lede">{t('Operator view · Local workflow evidence. Configuration does not prove a scheduled run or a production change.', 'نمای اپراتور · شواهد روند محلی. پیکربندی به معنی اجرای زمان‌بندی‌شده یا تغییر محیط عملیاتی نیست.')}</p>
    {busy && <SkeletonRows rows={2} lead={false} label={t('Loading operations…', 'در حال دریافت عملیات…')} />}
    {error && <Banner tone="danger">{t('Operations evidence is unavailable. Refresh to try again.', 'شواهد عملیات در دسترس نیست. برای تلاش دوباره، عملیات را تازه‌سازی کنید.')}</Banner>}
    {data && <>
      <div className="vx-group">
        <Fact label={t('Maintenance', 'نگهداری')}>{configured(data.maintenanceConfigured)}</Fact>
        <Fact label={t('Improvement workflow', 'روند بهبود')}>{configured(data.improvementConfigured)}</Fact>
      </div>
      <MaintenanceHealthPanel health={data.maintenance} locale={locale} />
      {report ? <Stats>
        <Stat label={t('Audit events', 'رویدادهای ممیزی')} value={n(report.auditEvents)} />
        <Stat label={t('Candidates', 'نامزدها')} value={n(report.candidates.length)} />
        <Stat label={t('Evaluations passed', 'ارزیابی‌های پذیرفته‌شده')} value={n(report.candidates.filter(c => c.evaluationStatus === 'passed').length)} />
        <Stat label={t('Signed approvals', 'تأییدهای امضاشده')} value={n(report.candidates.filter(c => c.humanDecision === 'approve').length)} />
      </Stats> : <Banner tone="info">{t('Local workflow report: unavailable.', 'گزارش روند محلی: در دسترس نیست.')}</Banner>}
    </>}
    <p className="vx-section-foot">{t('CI, deployment, production impact and cost: unavailable. Proposed causes remain hypotheses.', 'CI، استقرار، اثر عملیاتی و هزینه: در دسترس نیست. علت‌های پیشنهادی همچنان فرضیه هستند.')}</p>
  </section>;
}
