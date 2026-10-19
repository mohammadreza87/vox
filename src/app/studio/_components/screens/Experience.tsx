'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type AgentView, type Role } from '../../_lib/client';
import { experienceApi, type ExperienceSnapshot } from '../../_lib/experience-client';
import { TopBar } from '../ui';
import { RelationshipPanel } from '../RelationshipPanel';
import { ReminderPanel } from '../ReminderPanel';
import { LearningPanel } from '../LearningPanel';
import { PreferencePanel } from '../PreferencePanel';
import { PreferenceLearningPanel } from '../PreferenceLearningPanel';

export function ExperienceScreen({ onBack, role, notificationId }: { onBack: () => void; role?: Role; notificationId?: string }) {
  const [space, setSpace] = useState<'work' | 'personal'>('work');
  const [fa, setFa] = useState(false);
  const [data, setData] = useState<ExperienceSnapshot | null>(null);
  const [agents, setAgents] = useState<AgentView[]>([]);
  const [agentId, setAgentId] = useState('');
  const [timezone, setTimezone] = useState('');
  const [cap, setCap] = useState(2);
  const [quietStart, setQuietStart] = useState(21);
  const [quietEnd, setQuietEnd] = useState(8);
  const [inbox, setInbox] = useState(false);
  const [proactive, setProactive] = useState(false);
  const [reminders, setReminders] = useState(false);
  const [notificationScope, setNotificationScope] = useState<'work' | 'personal' | null>(null);
  const [notificationMissing, setNotificationMissing] = useState(false);
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
    setData(null); setError(''); setStatus('');
    try {
      const [snapshot, listed] = await Promise.all([experienceApi.read(space), api.agents()]);
      if (generation.current !== current) return;
      apply(snapshot); setAgents(listed.agents.filter(a => a.status === 'active')); setAgentId('');
    } catch { if (generation.current === current) setError('Settings could not be loaded. / تنظیمات دریافت نشد.'); }
  }, [space]);
  const invalidate = useCallback(() => { generation.current++; }, []);
  useEffect(() => { void load(); return invalidate; }, [load, invalidate]);
  useEffect(() => {
    let active = true;
    if (!notificationId || typeof experienceApi.resolveNotification !== 'function') return;
    setNotificationMissing(false); setNotificationScope(null);
    void experienceApi.resolveNotification(notificationId).then(result => { if (active) { setNotificationScope(result.space); setSpace(result.space); } }).catch(() => { if (active) setNotificationMissing(true); });
    return () => { active = false; };
  }, [notificationId]);
  useEffect(() => {
    if (!notificationId || !notificationScope || data?.space !== notificationScope) return;
    const item = (data.reminders ?? data.inbox).find(item => item.id === notificationId);
    if (!item) { setNotificationMissing(true); return; }
    const element = document.getElementById(`reminder-${notificationId}`);
    element?.scrollIntoView?.({ block: 'center' }); element?.focus();
  }, [data, notificationId, notificationScope]);
  const mutate = async (action: () => Promise<ExperienceSnapshot>) => {
    if (busy) return;
    const current = generation.current;
    setBusy(true); setStatus(''); setError('');
    try {
      const next = await action();
      if (generation.current === current) {
        apply(next);
        setStatus(t('Saved.', 'ذخیره شد.'));
      }
    }
    catch (error) { if (generation.current === current) {
      const code = error instanceof Error ? error.message : '';
      setError(code === 'reminder_delivery_busy' ? t('A reminder is being dispatched. Wait a moment, refresh and review renewal again.', 'یک یادآور در حال ارسال است. کمی صبر کنید، صفحه را تازه و تمدید را دوباره بررسی کنید.') :
        code === 'reminder_authorization_renewal_required' ? t('Renew Telegram authorization or turn Telegram reminders off before choosing this due time.', 'پیش از انتخاب این زمان مقرر، مجوز تلگرام را تمدید یا یادآورهای تلگرام را خاموش کنید.') :
        code === 'reminder_disclosure_required' ? t('Review the Telegram reminder choice again before confirming.', 'پیش از تأیید، انتخاب یادآور تلگرام را دوباره بررسی کنید.') :
        t('The change was not confirmed. Refresh before trying again.', 'تغییر تأیید نشد. پیش از تلاش دوباره صفحه را تازه کنید.'));
    } }
    finally { setBusy(false); }
  };
  const command = () => ({ space, expectedRevision: data!.revision, eventId: crypto.randomUUID() });
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
          <label>{t('Agent', 'عامل')}<select className="vx-input" disabled={busy} value={agentId} onChange={e => setAgentId(e.target.value)}><option value="">{t('Choose an agent', 'انتخاب عامل')}</option>{agents.map(a => <option key={a.id} value={a.id}>{a.persona.name}</option>)}</select></label>
          <PreferenceLearningPanel key={`learning:${space}:${agentId}`} agentId={agentId} space={space} confirmed={data.confirmed} revisionHint={data.revision} locale={fa ? 'fa' : 'en'} onRevision={revision => setData(current => current?.space === space ? { ...current, revision } : current)} />
          <PreferencePanel key={`${space}:${agentId}`} agentId={agentId} space={space} confirmed={data.confirmed} revisionHint={data.revision} locale={fa ? 'fa' : 'en'} onSnapshot={apply} />
        </div>
        <div className="vx-card vx-privacy-card">
          <h2 className="vx-head">{t('Notification settings', 'تنظیمات اعلان')}</h2>
          <p className="vx-small vx-2">{t('These settings control your private inbox. Telegram reminders have a separate choice below. The suggestion limit applies across both spaces.', 'این تنظیمات برای صندوق خصوصی شما هستند. یادآور تلگرام در پایین انتخابی جدا دارد. محدودیت پیشنهاد در مجموع هر دو فضا اعمال می‌شود.')}</p>
          <label className="vx-privacy-checkbox"><input type="checkbox" checked={inbox} disabled={busy || !data.confirmed} onChange={e => setInbox(e.target.checked)} />{t('Enable inbox', 'فعال کردن صندوق')}</label>
          <label className="vx-privacy-checkbox"><input type="checkbox" checked={proactive} disabled={busy || (!proactive && !data.capabilities.proactiveInbox)} onChange={e => setProactive(e.target.checked)} />{t('Helpful suggestions', 'پیشنهادهای مفید')}</label>
          <label className="vx-privacy-checkbox"><input type="checkbox" checked={reminders} disabled={busy || (!reminders && !data.capabilities.reminders)} onChange={e => setReminders(e.target.checked)} />{t('Requested reminders', 'یادآورهای درخواستی')}</label>
          <label>{t('Selected timezone', 'منطقهٔ زمانی انتخابی')}<input className="vx-input" value={timezone} disabled={busy} placeholder="Europe/Tallinn" onChange={e => setTimezone(e.target.value)} /></label>
          <label>{t('Maximum suggestions per 24 hours', 'بیشترین پیشنهاد در ۲۴ ساعت')}<input className="vx-input" type="number" min={0} max={20} value={cap} disabled={busy} onChange={e => setCap(Number(e.target.value))} /></label>
          <div className="vx-privacy-actions"><label>{t('Quiet hours start', 'شروع سکوت')}<input className="vx-input" type="number" min={0} max={23} value={quietStart} disabled={busy} onChange={e => setQuietStart(Number(e.target.value))} /></label><label>{t('Quiet hours end', 'پایان سکوت')}<input className="vx-input" type="number" min={0} max={23} value={quietEnd} disabled={busy} onChange={e => setQuietEnd(Number(e.target.value))} /></label></div>
          <button className="vx-btn vx-btn-secondary" disabled={busy || !data.confirmed} onClick={() => void mutate(() => experienceApi.settings({ ...command(), timezone: timezone.trim() || null, dailyCap: cap, quietStartHour: quietStart, quietEndHour: quietEnd, inboxEnabled: inbox, proactiveEnabled: proactive, reminderEnabled: reminders }))}>{t('Save notification settings', 'ذخیرهٔ تنظیمات اعلان')}</button>
        </div>
        {notificationMissing && <p role="status">{t('This reminder is not available.', 'این یادآور در دسترس نیست.')}</p>}
        <ReminderPanel key={space} data={data} agentId={agentId} fa={fa} busy={busy} mutate={mutate} notificationId={notificationId} />
        {agentId && typeof api.relationship === 'function' && <RelationshipPanel key={`${space}:${agentId}`} agentId={agentId} name={agents.find(a => a.id === agentId)?.persona.name ?? ''} space={space} locale={fa ? 'fa' : 'en'} identityConfirmed={data.confirmed} />}
        <h2 className="vx-title-m">{t('Your inbox', 'صندوق شما')}</h2>
        {!data.inbox.length && <p className="vx-small vx-2">{t('Nothing to show right now.', 'اکنون موردی برای نمایش نیست.')}</p>}
        {data.inbox.filter(item => item.kind !== 'requested_reminder').map(item => <article className="vx-card vx-privacy-card" key={item.id}><h3 className="vx-head">{item.kind === 'requested_reminder' ? item.label : t('A reply did not finish. You can try again when convenient.', 'یک پاسخ کامل نشد. هر زمان مناسب بود می‌توانید دوباره تلاش کنید.')}</h3><div className="vx-privacy-actions"><button className="vx-btn vx-btn-secondary vx-btn-sm" disabled={busy} onClick={() => void mutate(() => experienceApi.feedback({ ...command(), itemId: item.id, action: 'useful' }))}>{t('Useful', 'مفید بود')}</button><button className="vx-btn vx-btn-secondary vx-btn-sm" disabled={busy} onClick={() => void mutate(() => experienceApi.feedback({ ...command(), itemId: item.id, action: 'dismiss' }))}>{t('Dismiss', 'بستن')}</button></div></article>)}

      </>}
      <LearningPanel space={space} locale={fa ? 'fa' : 'en'} showOperations={role === 'owner' || role === 'superadmin'} />
    </section>
  </>;
}
