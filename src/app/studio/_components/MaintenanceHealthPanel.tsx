'use client';
import { maintenanceHealthSchema } from '@/lib/adaptive/lifecycle/maintenance-health-contracts';
import { Banner, Stat, Stats } from './ui';

/** Recorded operator metadata only. This view does not derive worker liveness. */
export function MaintenanceHealthPanel({ health, locale }: { health: unknown; locale: 'en' | 'fa' }) {
  const fa = locale === 'fa';
  const t = (en: string, persian: string) => fa ? persian : en;
  const parsed = maintenanceHealthSchema.safeParse(health);
  const value = parsed.success ? parsed.data : null;
  const unavailable = t('Unavailable', 'در دسترس نیست');
  const states = {
    not_configured: unavailable,
    not_started: t('No run recorded', 'اجرایی ثبت نشده است'),
    leased: t('Worker lease recorded', 'مجوز موقت کار ثبت شده است'),
    continued: t('Pass recorded incomplete', 'این نوبت ناتمام ثبت شده است'),
    completed: t('Pass recorded complete', 'تکمیل این نوبت ثبت شده است'),
    failed: t('Failure recorded', 'خطا ثبت شده است'),
    busy: t('Status temporarily busy', 'دریافت وضعیت موقتاً ممکن نیست'),
    stale: t('Recorded lease expired', 'انقضای مجوز موقت ثبت شده است'),
    unavailable,
  };
  const date = (timestamp: number | null | undefined) => {
    if (timestamp == null) return unavailable;
    const result = new Date(timestamp);
    return Number.isFinite(result.getTime())
      ? <time dateTime={result.toISOString()}><bdi>{result.toLocaleString(fa ? 'fa-IR' : 'en-US')}</bdi></time>
      : unavailable;
  };
  const number = (count: number | undefined) => count == null ? unavailable : <bdi>{count.toLocaleString(fa ? 'fa-IR' : 'en-US')}</bdi>;
  const checkpoint = value?.checkpoint;
  const items = [
    [t('Status as of', 'وضعیت در زمان'), date(value?.observedAt)],
    [t('Last recorded activity', 'آخرین فعالیت ثبت‌شده'), date(checkpoint?.updatedAt)],
    [t('Last recorded result', 'آخرین نتیجهٔ ثبت‌شده'), checkpoint ? states[checkpoint.recordedStatus] : unavailable],
    [t('Pages in recorded progress', 'صفحه‌ها در پیشرفت ثبت‌شده'), number(checkpoint?.checkpointedPages)],
    [t('Accounts in recorded progress', 'حساب‌ها در پیشرفت ثبت‌شده'), number(checkpoint?.checkpointedAccounts)],
    ...(value?.leaseExpiresAt != null ? [[t('Recorded lease expiry', 'زمان انقضای مجوز موقت ثبت‌شده'), date(value.leaseExpiresAt)]] : []),
  ];
  const tone = value?.state === 'failed' || value?.state === 'stale' || checkpoint?.failure === 'sweep_failed' ? 'warn' : value?.state === 'completed' ? 'live' : '';
  return <section aria-label={t('Maintenance status', 'وضعیت نگهداری')} dir={fa ? 'rtl' : 'ltr'} lang={locale} className="vx-maint">
    <div className="vx-maint-head">
      <h3 className="vx-row-title">{t('Maintenance status', 'وضعیت نگهداری')}</h3>
      <span className={`vx-pill${tone ? ` ${tone}` : ''}`} role="status"><span className="vx-pill-dot" aria-hidden="true" />{value ? states[value.state] : unavailable}</span>
    </div>
    <p className="vx-section-foot">{t('System-wide status, independent of your selected space. This view does not run maintenance.', 'وضعیت کل سامانه، مستقل از فضای انتخاب‌شدهٔ شما. این نما نگهداری را اجرا نمی‌کند.')}</p>
    {value?.state === 'not_configured' && <p className="vx-section-foot">{t('Status observation is not configured.', 'مشاهدهٔ وضعیت پیکربندی نشده است.')}</p>}
    {checkpoint?.failure === 'sweep_failed' && <Banner tone="warn">{t('A maintenance failure was recorded.', 'یک خطای نگهداری ثبت شده است.')}</Banner>}
    <Stats compact>
      {items.map(([label, content]) => <Stat key={String(label)} label={label} value={content} />)}
    </Stats>
    <p className="vx-section-foot">{t('Checkpoint counts do not measure unique people or deletions.', 'این شمارنده‌های پیشرفت، تعداد افراد یکتا یا حذف داده‌ها را نشان نمی‌دهند.')}</p>
    <p className="vx-section-foot">{t('Recorded progress is not proof of deletion or a running worker.', 'پیشرفت ثبت‌شده، انجام حذف یا در حال اجرا بودن فرایند را ثابت نمی‌کند.')}</p>
  </section>;
}
