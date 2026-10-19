'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type AgentView } from '../../_lib/client';
import { experienceApi, type ExperienceSnapshot } from '../../_lib/experience-client';
import { TopBar } from '../ui';

export function ExperienceScreen({ onBack }: { onBack: () => void }) {
  const [space, setSpace] = useState<'work' | 'personal'>('work');
  const [fa, setFa] = useState(false);
  const [data, setData] = useState<ExperienceSnapshot | null>(null);
  const [agents, setAgents] = useState<AgentView[]>([]);
  const [agentId, setAgentId] = useState('');
  const [length, setLength] = useState<'brief' | 'balanced' | 'detailed'>('balanced');
  const [timezone, setTimezone] = useState('');
  const [cap, setCap] = useState(2);
  const [quietStart, setQuietStart] = useState(21);
  const [quietEnd, setQuietEnd] = useState(8);
  const [inbox, setInbox] = useState(false);
  const [proactive, setProactive] = useState(false);
  const [reminders, setReminders] = useState(false);
  const [label, setLabel] = useState('');
  const [due, setDue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const generation = useRef(0);
  const t = (en: string, persian: string) => fa ? persian : en;
  const apply = (value: ExperienceSnapshot) => {
    setData(value); setTimezone(value.settings.timezone ?? ''); setCap(value.settings.dailyCap);
    setQuietStart(value.settings.quietStartHour); setQuietEnd(value.settings.quietEndHour);
    setInbox(value.settings[value.space].inboxEnabled); setProactive(value.settings[value.space].proactiveEnabled); setReminders(value.settings[value.space].reminderEnabled);
  };
  const load = useCallback(async () => {
    const current = ++generation.current;
    setData(null); setError(''); setStatus(''); setLabel(''); setDue('');
    try {
      const [snapshot, listed] = await Promise.all([experienceApi.read(space), api.agents()]);
      if (generation.current !== current) return;
      apply(snapshot); setAgents(listed.agents.filter(a => a.status === 'active')); setAgentId('');
    } catch { if (generation.current === current) setError('Settings could not be loaded. / تنظیمات دریافت نشد.'); }
  }, [space]);
  const invalidate = useCallback(() => { generation.current++; }, []);
  useEffect(() => { void load(); return invalidate; }, [load, invalidate]);
  const mutate = async (action: () => Promise<ExperienceSnapshot>, refreshPreference = false) => {
    if (busy) return;
    const current = generation.current;
    setBusy(true); setStatus(''); setError('');
    try {
      const next = await action();
      if (generation.current === current) {
        apply(next);
        if (refreshPreference) {
          const saved = next.preferences.find(p => p.agentId === agentId && p.setting.key === 'response_length' && p.status === 'active');
          setLength(saved?.setting.key === 'response_length' ? saved.setting.value : 'balanced');
        }
        setStatus(t('Saved.', 'ذخیره شد.'));
      }
    }
    catch { if (generation.current === current) setError(t('The change was not confirmed. Refresh before trying again.', 'تغییر تأیید نشد. پیش از تلاش دوباره صفحه را تازه کنید.')); }
    finally { setBusy(false); }
  };
  const command = () => ({ space, expectedRevision: data!.revision, eventId: crypto.randomUUID() });
  const selectAgent = (id: string) => {
    setAgentId(id);
    const preference = data?.preferences.find(p => p.agentId === id && p.setting.key === 'response_length' && p.status === 'active');
    setLength(preference?.setting.key === 'response_length' ? preference.setting.value : 'balanced');
  };
  return <><TopBar onBack={onBack} title={t('Your experience', 'تجربهٔ شما')} right={<button className="vx-chip" disabled={busy} onClick={() => setFa(!fa)}>{fa ? 'English' : 'فارسی'}</button>} />
    <section className="vx-scroll vx-privacy" dir={fa ? 'rtl' : 'ltr'} lang={fa ? 'fa' : 'en'} aria-busy={busy}>
      <p className="vx-2">{t('Tell Vox what works for you. Saved choices, learning permissions and notification settings remain separate.', 'به وکس بگویید چه چیزی برای شما مناسب است. انتخاب‌های ذخیره‌شده، مجوزهای یادگیری و تنظیمات اعلان جدا هستند.')}</p>
      <div className="vx-privacy-spaces" role="group" aria-label={t('Experience space', 'فضای تجربه')}>{(['work', 'personal'] as const).map(s => <button className="vx-btn vx-btn-secondary" key={s} disabled={busy} aria-pressed={space === s} onClick={() => setSpace(s)}>{s === 'work' ? t('Work', 'کاری') : t('Personal', 'شخصی')}</button>)}</div>
      {error && <div className="vx-banner danger" role="alert">{error}<button className="vx-btn vx-btn-secondary vx-btn-sm" disabled={busy} onClick={() => void load()}>{t('Refresh', 'تازه‌سازی')}</button></div>}
      {status && <p role="status">{status}</p>}
      {!data && !error && <p role="status">{t('Loading…', 'در حال دریافت…')}</p>}
      {data && <>
        <div className="vx-card vx-privacy-card">
          <h2 className="vx-head">{t('Reply preferences', 'ترجیح‌های پاسخ')}</h2>
          <label>{t('Agent', 'عامل')}<select className="vx-input" disabled={busy} value={agentId} onChange={e => selectAgent(e.target.value)}><option value="">{t('Choose an agent', 'انتخاب عامل')}</option>{agents.map(a => <option key={a.id} value={a.id}>{a.persona.name}</option>)}</select></label>
          <label>{t('Reply length', 'اندازهٔ پاسخ')}<select className="vx-input" disabled={busy} value={length} onChange={e => setLength(e.target.value as typeof length)}><option value="brief">{t('Brief', 'کوتاه')}</option><option value="balanced">{t('Balanced', 'متعادل')}</option><option value="detailed">{t('Detailed', 'با جزئیات')}</option></select></label>
          <p className="vx-small vx-2">{t('Your current request always comes first. Saved preferences are applied only with personalization permission and an explicit agent grant.', 'درخواست فعلی شما همیشه مقدم است. ترجیح‌های ذخیره‌شده فقط با مجوز شخصی‌سازی و دسترسی صریح عامل استفاده می‌شوند.')}</p>
          <div className="vx-privacy-actions"><button className="vx-btn vx-btn-secondary" disabled={busy || !agentId || !data.confirmed} onClick={() => void mutate(() => experienceApi.preference({ ...command(), agentId, setting: { key: 'response_length', value: length }, action: 'set' }), true)}>{t('Save preference', 'ذخیرهٔ ترجیح')}</button><button className="vx-btn vx-btn-secondary" disabled={busy || !agentId || !data.confirmed} onClick={() => void mutate(() => experienceApi.preference({ ...command(), agentId, setting: { key: 'response_length', value: length }, action: 'reset' }), true)}>{t('Reset', 'بازنشانی')}</button></div>
        </div>
        <div className="vx-card vx-privacy-card">
          <h2 className="vx-head">{t('Notification settings', 'تنظیمات اعلان')}</h2>
          <p className="vx-small vx-2">{t('These settings control your private inbox. They do not enable email, SMS or Telegram delivery. The interruption limit applies across both spaces.', 'این تنظیمات برای صندوق خصوصی شما هستند و ارسال ایمیل، پیامک یا تلگرام را فعال نمی‌کنند. محدودیت مزاحمت در مجموع هر دو فضا اعمال می‌شود.')}</p>
          <label className="vx-privacy-checkbox"><input type="checkbox" checked={inbox} disabled={busy || !data.confirmed} onChange={e => setInbox(e.target.checked)} />{t('Enable inbox', 'فعال کردن صندوق')}</label>
          <label className="vx-privacy-checkbox"><input type="checkbox" checked={proactive} disabled={busy || (!proactive && !data.capabilities.proactiveInbox)} onChange={e => setProactive(e.target.checked)} />{t('Helpful suggestions', 'پیشنهادهای مفید')}</label>
          <label className="vx-privacy-checkbox"><input type="checkbox" checked={reminders} disabled={busy || (!reminders && !data.capabilities.reminders)} onChange={e => setReminders(e.target.checked)} />{t('Requested reminders', 'یادآورهای درخواستی')}</label>
          <label>{t('Selected timezone', 'منطقهٔ زمانی انتخابی')}<input className="vx-input" value={timezone} disabled={busy} placeholder="Europe/Tallinn" onChange={e => setTimezone(e.target.value)} /></label>
          <label>{t('Maximum suggestions per 24 hours', 'بیشترین پیشنهاد در ۲۴ ساعت')}<input className="vx-input" type="number" min={0} max={20} value={cap} disabled={busy} onChange={e => setCap(Number(e.target.value))} /></label>
          <div className="vx-privacy-actions"><label>{t('Quiet hours start', 'شروع سکوت')}<input className="vx-input" type="number" min={0} max={23} value={quietStart} disabled={busy} onChange={e => setQuietStart(Number(e.target.value))} /></label><label>{t('Quiet hours end', 'پایان سکوت')}<input className="vx-input" type="number" min={0} max={23} value={quietEnd} disabled={busy} onChange={e => setQuietEnd(Number(e.target.value))} /></label></div>
          <button className="vx-btn vx-btn-secondary" disabled={busy || !data.confirmed} onClick={() => void mutate(() => experienceApi.settings({ ...command(), timezone: timezone.trim() || null, dailyCap: cap, quietStartHour: quietStart, quietEndHour: quietEnd, inboxEnabled: inbox, proactiveEnabled: proactive, reminderEnabled: reminders }))}>{t('Save notification settings', 'ذخیرهٔ تنظیمات اعلان')}</button>
        </div>
        <div className="vx-card vx-privacy-card"><h2 className="vx-head">{t('Create a reminder', 'ایجاد یادآور')}</h2><p className="vx-small vx-2">{t('Choose an agent above. A reminder appears in your authenticated inbox when it is due; it does not send an external message.', 'یک عامل را در بالا انتخاب کنید. یادآور در زمان مقرر در صندوق احراز هویت‌شدهٔ شما نمایش داده می‌شود و پیام بیرونی نمی‌فرستد.')}</p><label>{t('Reminder', 'یادآور')}<input className="vx-input" value={label} maxLength={160} disabled={busy || !data.capabilities.reminders} onChange={e => setLabel(e.target.value)} /></label><label>{t('Due time (your device local time)', 'زمان مقرر (زمان محلی دستگاه)')}<input className="vx-input" type="datetime-local" value={due} disabled={busy || !data.capabilities.reminders} onChange={e => setDue(e.target.value)} /></label><button className="vx-btn vx-btn-secondary" disabled={busy || !agentId || !label.trim() || !due || !data.capabilities.reminders} onClick={() => void mutate(() => experienceApi.reminder({ ...command(), agentId, label, dueAt: new Date(due).getTime() }))}>{t('Create reminder', 'ایجاد یادآور')}</button></div>
        <h2 className="vx-title-m">{t('Your inbox', 'صندوق شما')}</h2>
        {!data.inbox.length && <p className="vx-small vx-2">{t('Nothing to show right now.', 'اکنون موردی برای نمایش نیست.')}</p>}
        {data.inbox.map(item => <article className="vx-card vx-privacy-card" key={item.id}><h3 className="vx-head">{item.kind === 'requested_reminder' ? item.label : t('A reply did not finish. You can try again when convenient.', 'یک پاسخ کامل نشد. هر زمان مناسب بود می‌توانید دوباره تلاش کنید.')}</h3><div className="vx-privacy-actions"><button className="vx-btn vx-btn-secondary vx-btn-sm" disabled={busy} onClick={() => void mutate(() => experienceApi.feedback({ ...command(), itemId: item.id, action: 'useful' }))}>{t('Useful', 'مفید بود')}</button><button className="vx-btn vx-btn-secondary vx-btn-sm" disabled={busy} onClick={() => void mutate(() => experienceApi.feedback({ ...command(), itemId: item.id, action: 'dismiss' }))}>{t('Dismiss', 'بستن')}</button></div></article>)}
        <div className="vx-card vx-privacy-card"><h2 className="vx-head">{t('Your usage measurements', 'اندازه‌گیری‌های استفادهٔ شما')}</h2><p className="vx-small vx-2">{data.observations.available ? t(`${data.observations.total} recorded turns. Response completion is not proof that a task succeeded.`, `${data.observations.total} نوبت ثبت‌شده. کامل شدن پاسخ به معنی موفقیت کار نیست.`) : t('Optional usage analytics is off or unavailable.', 'تحلیل اختیاری استفاده خاموش است یا در دسترس نیست.')}</p></div>
      </>}
    </section>
  </>;
}
