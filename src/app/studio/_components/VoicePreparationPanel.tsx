'use client';
import type { VoicePartialCapability } from '@/lib/adaptive/prediction/voice-client';
import { Switch } from './ui';

/** A switch row for the call options sheet: off by default, and never offered without a verified server capability. */
export function VoicePreparationPanel({ capability, enabled, onChange, locale = 'en' }: {
  capability?: VoicePartialCapability; enabled: boolean; onChange(value: boolean): void; locale?: 'en' | 'fa';
}) {
  const fa = locale === 'fa', available = capability?.available === true;
  return <section className="vx-section" dir={fa ? 'rtl' : 'ltr'} lang={locale} aria-label={fa ? 'آماده‌سازی هنگام صحبت' : 'Prepare while I speak'}>
    <div className="vx-group">
      <Switch checked={available && enabled} disabled={!available} onChange={onChange}
        label={fa ? 'هنگام صحبت آماده‌سازی کن' : 'Prepare while I speak'} sub={fa ? 'اختیاری · به‌طور پیش‌فرض خاموش' : 'Optional · off by default'} />
    </div>
    <p className="vx-section-foot">{fa
      ? 'با روشن‌کردن، متن موقت صحبتتان پیش از پایان برای پیش‌بینی محدود و آماده‌سازی اطلاعات مجاز به Vox و ارائه‌دهندهٔ Decisions فرستاده می‌شود. این کار هویت یا دسترسی را تغییر نمی‌دهد و عملی اجرا نمی‌کند. هر زمان خاموش کنید.'
      : 'When enabled, provisional speech text is sent to Vox and its Decisions provider before you finish, for bounded prediction and preparation of permitted context. It cannot change identity or access, or execute an action. Turn it off at any time.'}</p>
    {!available && <p className="vx-section-foot" role="status">{fa
      ? 'در دسترس نیست: پیکربندی رویداد متن موقت یا سرویس پیش‌بینی این تماس تأیید نشده است. تماس معمولی همچنان قابل استفاده است.'
      : 'Unavailable: this call’s provisional transcript configuration or prediction service is unverified. Ordinary calling remains available.'}</p>}
  </section>;
}
