'use client';
import { maintenanceHealthSchema } from '@/lib/adaptive/lifecycle/maintenance-health-contracts';

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
  return <section aria-label={t('Maintenance status', 'وضعیت نگهداری')} dir={fa ? 'rtl' : 'ltr'} lang={locale}
    style={{ display: 'grid', gap: 12, borderBlockStart: '1px solid var(--hair)', paddingBlockStart: 16, minWidth: 0, overflowWrap: 'anywhere' }}>
    <h3 className="vx-head" style={{ fontSize: 18 }}>{t('Maintenance status', 'وضعیت نگهداری')}</h3>
    <p className="vx-small vx-2">{t('System-wide status, independent of your selected space. This view does not run maintenance.', 'وضعیت کل سامانه، مستقل از فضای انتخاب‌شدهٔ شما. این نما نگهداری را اجرا نمی‌کند.')}</p>
    <p className="vx-small" role="status">{value ? states[value.state] : unavailable}</p>
    {value?.state === 'not_configured' && <p className="vx-small vx-2">{t('Status observation is not configured.', 'مشاهدهٔ وضعیت پیکربندی نشده است.')}</p>}
    <dl style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 14rem), 1fr))', gap: 12, margin: 0 }}>
      {items.map(([label, content]) => <div key={String(label)} style={{ minWidth: 0 }}>
        <dt className="vx-small vx-2">{label}</dt><dd className="vx-small" style={{ margin: '4px 0 0' }}>{content}</dd>
      </div>)}
    </dl>
    <p className="vx-small vx-2">{t('Checkpoint counts do not measure unique people or deletions.', 'این شمارنده‌های پیشرفت، تعداد افراد یکتا یا حذف داده‌ها را نشان نمی‌دهند.')}</p>
    {checkpoint?.failure === 'sweep_failed' && <p className="vx-small">{t('A maintenance failure was recorded.', 'یک خطای نگهداری ثبت شده است.')}</p>}
    <p className="vx-small vx-2">{t('Recorded progress is not proof of deletion or a running worker.', 'پیشرفت ثبت‌شده، انجام حذف یا در حال اجرا بودن فرایند را ثابت نمی‌کند.')}</p>
  </section>;
}
