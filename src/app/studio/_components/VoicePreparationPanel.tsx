'use client';
import type { VoicePartialCapability } from '@/lib/adaptive/prediction/voice-client';

export function VoicePreparationPanel({ capability, enabled, onChange, locale = 'en' }: {
  capability?: VoicePartialCapability; enabled: boolean; onChange(value: boolean): void; locale?: 'en' | 'fa';
}) {
  const fa = locale === 'fa', available = capability?.available === true;
  return <section dir={fa ? 'rtl' : 'ltr'} lang={locale} style={{ padding: '0 24px', position: 'relative' }}>
    <label className="vx-small"><input type="checkbox" checked={available && enabled} disabled={!available}
      onChange={event => onChange(event.target.checked)} /> {fa ? 'هنگام صحبت آماده‌سازی کن (اختیاری)' : 'Prepare while I speak (optional)'}</label>
    <p className="vx-small vx-2">{fa
      ? 'با روشن‌کردن، متن موقت صحبتتان پیش از پایان برای پیش‌بینی محدود و آماده‌سازی اطلاعات مجاز به Vox و ارائه‌دهندهٔ Decisions فرستاده می‌شود. این کار هویت یا دسترسی را تغییر نمی‌دهد و عملی اجرا نمی‌کند. هر زمان خاموش کنید.'
      : 'When enabled, provisional speech text is sent to Vox and its Decisions provider before you finish, for bounded prediction and preparation of permitted context. It cannot change identity or access, or execute an action. Turn it off at any time.'}</p>
    {!available && <p className="vx-small vx-2" role="status">{fa
      ? 'در دسترس نیست: پیکربندی رویداد متن موقت یا سرویس پیش‌بینی این تماس تأیید نشده است. تماس معمولی همچنان قابل استفاده است.'
      : 'Unavailable: this call’s provisional transcript configuration or prediction service is unverified. Ordinary calling remains available.'}</p>}
  </section>;
}
