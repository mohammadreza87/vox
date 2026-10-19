'use client';
import { useState } from 'react';
import type { ExperienceSnapshot, InboxItem } from '@/lib/adaptive/runtime/contracts';
import { experienceApi } from '../_lib/experience-client';
export function ReminderPanel({ data, agentId, fa, busy, mutate, notificationId }: { data: ExperienceSnapshot; agentId: string; fa: boolean; busy: boolean;
  mutate: (action: () => Promise<ExperienceSnapshot>) => Promise<void>; notificationId?: string }) {
  const [label, setLabel] = useState(''), [due, setDue] = useState(''), [exactTime, setExactTime] = useState(false);
  const t = (en: string, persian: string) => fa ? persian : en;
  const command = () => ({ space: data.space, expectedRevision: data.revision, eventId: crypto.randomUUID() });
  const reminders = data.reminders ?? data.inbox.filter(item => item.kind === 'requested_reminder');
  const state = data.reminderTelegram;
  const date = (at: number) => { try { return new Intl.DateTimeFormat(fa ? 'fa-IR' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short', ...(data.settings.timezone ? { timeZone: data.settings.timezone } : {}) }).format(at); } catch { return new Date(at).toISOString(); } };
  const delivery = (item: InboxItem) => {
    const current = item.delivery;
    if (!current) return t('Inbox only.', 'فقط صندوق.');
    if (current.state === 'accepted') return t('Telegram accepted the alert. Delivery and reading are not verified.', 'تلگرام اعلان را پذیرفت. تحویل و خواندن تأیید نشده است.');
    if (current.state === 'unknown') return current.acknowledgedAt ? t('Delivery remains unknown; you have reviewed this reminder.', 'تحویل همچنان نامشخص است؛ این یادآور را بررسی کرده‌اید.') : t('Delivery is uncertain. Vox will not retry automatically. Snoozing explicitly schedules a new alert.', 'تحویل نامشخص است. وکس خودکار دوباره ارسال نمی‌کند. تعویق، اعلان تازه‌ای را با درخواست صریح شما برنامه‌ریزی می‌کند.');
    if (current.state === 'failed') return t('Telegram did not accept the alert. Snooze to request a new attempt.', 'تلگرام اعلان را نپذیرفت. برای درخواست تلاش تازه، آن را به تعویق بیندازید.');
    if (current.state === 'cancelled') return t('Telegram alert cancelled; the reminder stays in your inbox.', 'اعلان تلگرام لغو شد؛ یادآور در صندوق می‌ماند.');
    return t('Telegram alert scheduled; quiet hours and current permission apply.', 'اعلان تلگرام برنامه‌ریزی شد؛ ساعت‌های سکوت و مجوز جاری اعمال می‌شوند.');
  };
  return <section aria-label={t('Reminder scheduling', 'زمان‌بندی یادآور')}>
    <div className="vx-card vx-privacy-card"><h2 className="vx-head">{t('Telegram reminders', 'یادآورهای تلگرام')}</h2>
      <p className="vx-small vx-2">{t('A separate choice for new reminders in this space. Only a generic alert and an opaque reference leave Vox; reminder details stay in your authenticated inbox. This can work while the app is closed when the server scheduler is enabled.', 'انتخابی جدا برای یادآورهای تازه در این فضا. فقط اعلان عمومی و شناسهٔ بی‌معنا از وکس خارج می‌شود؛ جزئیات در صندوق احراز هویت‌شده می‌ماند. با فعال بودن زمان‌بند سرور، هنگام بسته بودن برنامه هم کار می‌کند.')}</p>
      {!state?.connected && <p>{t('First send a private message to VoxxBot, then refresh. Opening the app alone does not authorize a Telegram recipient.', 'ابتدا یک پیام خصوصی به VoxxBot بفرستید و سپس تازه‌سازی کنید. باز کردن برنامه به‌تنهایی گیرندهٔ تلگرام را تأیید نمی‌کند.')}</p>}
      {!state?.available && <p>{t('Telegram reminders are unavailable until the server release, reminder permission and private recipient are ready. Inbox reminders remain separate.', 'یادآور تلگرام تا آماده شدن انتشار سرور، مجوز یادآور و گیرندهٔ خصوصی در دسترس نیست. یادآور صندوق جداست.')}</p>}
      {state?.expiresAt && <p>{t('Generic alert authorization ends: ', 'پایان مجوز اعلان عمومی: ')}{date(state.expiresAt)}</p>}
      {state?.renewalRequired && <p role="status">{t('Review and renew Telegram authorization before scheduling another alert, or turn Telegram reminders off for inbox-only reminders.', 'پیش از برنامه‌ریزی اعلان تازه، مجوز تلگرام را بررسی و تمدید کنید؛ یا برای یادآور فقط در صندوق، تلگرام را خاموش کنید.')}</p>}
      <p className="vx-small">{t('This choice permits only generic alerts for reminders you request in this space for up to 30 days while you are away. It does not extend private access or automatically renew. Current permission, recipient, timezone and quiet hours still apply. Reminders past the displayed end require renewal. Renewal keeps already scheduled, currently permitted alerts; inbox-only or uncertain alerts are not armed.', 'این انتخاب فقط اعلان عمومیِ یادآورهایی را که در این فضا درخواست می‌کنید، تا ۳۰ روز هنگام نبودنتان مجاز می‌کند. دسترسی خصوصی را تمدید نمی‌کند و خودکار تمدید نمی‌شود. مجوز جاری، گیرنده، منطقهٔ زمانی و ساعت سکوت همچنان اعمال می‌شوند. یادآور پس از پایان نمایش‌داده‌شده به تمدید نیاز دارد. تمدید، اعلان‌های برنامه‌ریزی‌شده با مجوز جاری را نگه می‌دارد؛ یادآور فقط در صندوق یا با تحویل نامشخص فعال نمی‌شود.')}</p>
      <button className="vx-btn vx-btn-secondary" disabled={busy || !state?.available} onClick={() => void mutate(() => experienceApi.reminderChannelPresent(command()))}>{state?.enabled || state?.renewalRequired ? t('Review 30-day renewal', 'بررسی تمدید ۳۰ روزه') : t('Review Telegram reminder choice', 'بررسی انتخاب یادآور تلگرام')}</button>
      {(state?.enabled || state?.renewalRequired) && <button className="vx-btn vx-btn-secondary" disabled={busy} onClick={() => void mutate(() => experienceApi.reminderChannel({ ...command(), enabled: false }))}>{t('Turn Telegram reminders off', 'خاموش کردن یادآور تلگرام')}</button>}
      {state?.disclosure && <div role="group" aria-label={t('Confirm reminder authorization', 'تأیید مجوز یادآور')}><p>{t('Confirm this separate, time-limited reminder choice. You can turn it off at any time.', 'این انتخاب جداگانه و مدت‌دار یادآور را تأیید کنید. هر زمان می‌توانید آن را خاموش کنید.')}</p><button className="vx-btn vx-btn-secondary" disabled={busy} onClick={() => void mutate(() => experienceApi.reminderChannel({ ...command(), enabled: true, receipt: state.disclosure!.receipt, disclosureVersion: state.disclosure!.version }))}>{t('Allow generic alerts for up to 30 days', 'اجازهٔ اعلان عمومی تا ۳۰ روز')}</button></div>}
    </div>
    <div className="vx-card vx-privacy-card"><h2 className="vx-head">{t('Create a reminder', 'ایجاد یادآور')}</h2>
      <p className="vx-small vx-2">{t('Choose an agent above. The reminder appears in your private inbox; Telegram uses the separate choice above. Unknown timezone keeps alerts in the inbox.', 'یک عامل را در بالا انتخاب کنید. یادآور در صندوق خصوصی نمایش داده می‌شود؛ تلگرام از انتخاب جداگانهٔ بالا پیروی می‌کند. منطقهٔ زمانی نامشخص، اعلان را در صندوق نگه می‌دارد.')}</p>
      <label>{t('Reminder', 'یادآور')}<input className="vx-input" value={label} maxLength={160} disabled={busy || !data.capabilities.reminders} onChange={e => setLabel(e.target.value)} /></label>
      <label>{t('Due time (your device local time)', 'زمان مقرر (زمان محلی دستگاه)')}<input className="vx-input" type="datetime-local" value={due} disabled={busy || !data.capabilities.reminders} onChange={e => setDue(e.target.value)} /></label>
      <label className="vx-privacy-checkbox"><input type="checkbox" checked={exactTime} disabled={busy || !data.capabilities.reminders} onChange={e => setExactTime(e.target.checked)} />{t('Allow this requested reminder at its exact time during quiet hours', 'اجازهٔ این یادآور درخواستی در زمان دقیق، حتی در ساعت سکوت')}</label>
      <button className="vx-btn vx-btn-secondary" disabled={busy || !agentId || !label.trim() || !due || !data.capabilities.reminders} onClick={() => void mutate(() => experienceApi.reminder({ ...command(), agentId, label, dueAt: new Date(due).getTime(), quietHours: exactTime ? 'allow_at_requested_time' : 'respect' }))}>{t('Create reminder', 'ایجاد یادآور')}</button>
    </div>
    <h2 className="vx-title-m">{t('Your reminders', 'یادآورهای شما')}</h2>
    {!reminders.length && <p>{t('No active reminders.', 'یادآور فعالی وجود ندارد.')}</p>}
    {reminders.map(item => <article id={`reminder-${item.id}`} tabIndex={-1} className="vx-card vx-privacy-card" key={item.id} aria-current={notificationId === item.id ? 'true' : undefined}>
      <h3 className="vx-head" style={{ overflowWrap: 'anywhere' }}>{item.label}</h3><p>{date(item.dueAt)}</p><p role={item.delivery?.state === 'unknown' ? 'status' : undefined}>{delivery(item)}</p>
      <p className="vx-small vx-2">{t('Why this: you created this reminder for this agent and space.', 'دلیل نمایش: این یادآور را برای همین عامل و فضا ساخته‌اید.')}</p>
      <div className="vx-privacy-actions"><button className="vx-btn vx-btn-secondary vx-btn-sm" disabled={busy} onClick={() => void mutate(() => experienceApi.reminderAction({ ...command(), itemId: item.id, action: 'snooze', dueAt: Date.now() + 15 * 60_000 }))}>{t('Snooze 15 minutes', 'تعویق ۱۵ دقیقه')}</button>
        <button className="vx-btn vx-btn-secondary vx-btn-sm" disabled={busy} onClick={() => void mutate(() => experienceApi.reminderAction({ ...command(), itemId: item.id, action: 'cancel' }))}>{t('Cancel reminder', 'لغو یادآور')}</button>
        {item.delivery?.state === 'unknown' && !item.delivery.acknowledgedAt && <button className="vx-btn vx-btn-secondary vx-btn-sm" disabled={busy} onClick={() => void mutate(() => experienceApi.reminderAction({ ...command(), itemId: item.id, action: 'acknowledge_unknown' }))}>{t('I have reviewed this reminder', 'این یادآور را بررسی کردم')}</button>}
      </div>
    </article>)}
  </section>;
}
