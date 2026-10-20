'use client';
import { pauseText } from '../../_lib/product-pause-copy';
import { useProductPause } from '../../_lib/product-pause-client';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { api, tg, type AgentView, type Role } from '../../_lib/client';
import { experienceApi, type ExperienceSnapshot } from '../../_lib/experience-client';
import { TopBar } from '../ui';
import { RelationshipPanel } from '../RelationshipPanel';
import { ReminderPanel } from '../ReminderPanel';
import { LearningPanel } from '../LearningPanel';
import { RightsOperationsPanel } from '../RightsOperationsPanel';
import { PreferencePanel } from '../PreferencePanel';
import { PreferenceLearningPanel } from '../PreferenceLearningPanel';

type UseBoundary = Readonly<{ scope: string; space: 'work' | 'personal'; accountId?: string; useEpoch: number | null | undefined; blocked: boolean; phase: string | undefined }>;

export function ExperienceScreen({ onBack, role, notificationId }: { onBack: () => void; role?: Role; notificationId?: string }) {
  const [space, setSpace] = useState<'work' | 'personal'>('work');
  const [fa, setFa] = useState(false);
  const session = tg()?.initData ?? '';
  const pause = useProductPause(space, session);
  const blocked = pause.coveredBlocked;
  const owner = useRef({ session, accountId: pause.status?.accountId, generation: 0 });
  if (owner.current.session !== session) owner.current = { session, accountId: pause.status?.accountId, generation: 0 };
  if (pause.status?.accountId) {
    if (owner.current.accountId && owner.current.accountId !== pause.status.accountId) owner.current.generation++;
    owner.current.accountId = pause.status.accountId;
  }
  const scope = JSON.stringify([session, space, owner.current.generation]);
  const accountId = owner.current.accountId, useEpoch = pause.status?.useEpoch, phase = pause.phase;
  const boundary = useMemo<UseBoundary>(() => Object.freeze({ scope, space, accountId, useEpoch, blocked, phase }), [scope, space, accountId, useEpoch, blocked, phase]);
  const currentUse = useRef(boundary); currentUse.current = boundary;
  const admission = useRef({ scope, waiting: blocked && pause.status?.productPaused !== true });
  if (admission.current.scope !== scope) admission.current = { scope, waiting: blocked && pause.status?.productPaused !== true };
  const [dataScope, setDataScope] = useState(scope), [dataUse, setDataUse] = useState<UseBoundary | null>(null);
  const [storedData, setData] = useState<ExperienceSnapshot | null>(null);
  const data = useMemo(() => dataScope === scope && storedData?.space === space
    ? dataUse === boundary && !blocked ? storedData : { ...storedData, inbox: storedData.inbox.filter(item => item.kind === 'requested_reminder') } : null,
  [dataScope, scope, storedData, space, dataUse, boundary, blocked]);
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
  const renderGeneration = generation.current;
  const t = (en: string, persian: string) => fa ? persian : en;
  const apply = useCallback((value: ExperienceSnapshot, requestedUse: UseBoundary) => {
    if (requestedUse.scope !== currentUse.current.scope || value.space !== requestedUse.space) return false;
    const permitted = requestedUse === currentUse.current && !currentUse.current.blocked;
    const safe = permitted ? value : { ...value, inbox: value.inbox.filter(item => item.kind === 'requested_reminder') };
    // Keep the original immutable token. Old payloads never acquire current use authority.
    setDataScope(requestedUse.scope); setDataUse(requestedUse); setData(safe);
    setTimezone(value.settings.timezone ?? ''); setCap(value.settings.dailyCap);
    setQuietStart(value.settings.quietStartHour); setQuietEnd(value.settings.quietEndHour);
    setInbox(value.settings[value.space].inboxEnabled); setProactive(value.settings[value.space].proactiveEnabled); setReminders(value.settings[value.space].reminderEnabled);
    return true;
  }, []);
  const load = useCallback(async (preserveSelection = false) => {
    const requestedUse = currentUse.current;
    if (requestedUse.scope !== scope) return;
    const current = ++generation.current;
    if (!preserveSelection) setData(null);
    setError(''); setStatus('');
    try {
      const [snapshot, listed] = await Promise.all([experienceApi.read(space), api.agents()]);
      if (generation.current !== current) return;
      if (!apply(snapshot, requestedUse)) return;
      const activeAgents = listed.agents.filter(a => a.status === 'active');
      setAgents(activeAgents);
      setAgentId(current => preserveSelection && activeAgents.some(agent => agent.id === current) ? current : '');
    } catch { if (generation.current === current) setError('Settings could not be loaded. / تنظیمات دریافت نشد.'); }
  }, [space, scope, apply]);
  const invalidate = useCallback(() => { generation.current++; }, []);
  useLayoutEffect(() => { setBusy(false); void load(); return invalidate; }, [load, invalidate]);
  useEffect(() => {
    if (pause.phase === 'loading' && pause.status?.productPaused !== true) admission.current.waiting = true;
    if (admission.current.waiting && !blocked && !busy) {
      admission.current.waiting = false;
      // Keep mounted controls and selection while acquiring new use authority.
      // Unmounting a child would trigger another shared status refresh.
      void load(true);
    }
  }, [blocked, busy, load, pause.phase, pause.status?.productPaused]);
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
    const current = generation.current, requestedUse = currentUse.current;
    setBusy(true); setStatus(''); setError('');
    try {
      const next = await action();
      if (generation.current === current) {
        if (!apply(next, requestedUse)) return;
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
    finally { if (generation.current === current) setBusy(false); }
  };
  useLayoutEffect(() => {
    setData(current => current ? { ...current, inbox: current.inbox.filter(item => item.kind === 'requested_reminder') } : current);
  }, [boundary]);
  const command = () => ({ space, expectedRevision: data!.revision, eventId: crypto.randomUUID() });
  return <><TopBar onBack={onBack} title={t('Your experience', 'تجربهٔ شما')} right={<button className="vx-chip" disabled={busy} onClick={() => setFa(!fa)}>{fa ? 'English' : 'فارسی'}</button>} />
    <section className="vx-scroll vx-privacy" dir={fa ? 'rtl' : 'ltr'} lang={fa ? 'fa' : 'en'} aria-busy={busy}>
      <p className="vx-2">{t('Tell Vox what works for you. Saved choices, learning permissions and notification settings remain separate.', 'به وکس بگویید چه چیزی برای شما مناسب است. انتخاب‌های ذخیره‌شده، مجوزهای یادگیری و تنظیمات اعلان جدا هستند.')}</p>
      <div className="vx-privacy-spaces" role="group" aria-label={t('Experience space', 'فضای تجربه')}>{(['work', 'personal'] as const).map(s => <button className="vx-btn vx-btn-secondary" key={s} disabled={busy} aria-pressed={space === s} onClick={() => setSpace(s)}>{s === 'work' ? t('Work', 'کاری') : t('Personal', 'شخصی')}</button>)}</div>
      <button className="vx-btn vx-btn-secondary" disabled={busy} onClick={() => void load()}>{t('Refresh experience settings', 'تازه‌سازی تنظیمات تجربه')}</button>
      {error && <div className="vx-banner danger" role="alert">{error}<button className="vx-btn vx-btn-secondary vx-btn-sm" disabled={busy} onClick={() => void load()}>{t('Refresh', 'تازه‌سازی')}</button></div>}
      {status && <p role="status">{status}</p>}
      {!data && !error && <p role="status">{t('Loading…', 'در حال دریافت…')}</p>}
      {data && <>
        <div className="vx-card vx-privacy-card">
          <h2 className="vx-head">{t('Reply preferences', 'ترجیح‌های پاسخ')}</h2>
          <label>{t('Agent', 'عامل')}<select className="vx-input" disabled={busy} value={agentId} onChange={e => setAgentId(e.target.value)}><option value="">{t('Choose an agent', 'انتخاب عامل')}</option>{agents.map(a => <option key={a.id} value={a.id}>{a.persona.name}</option>)}</select></label>
          {pause.coveredBlocked ? <p className="vx-small">{pauseText(fa ? 'fa' : 'en', space, pause.status?.productPaused ? 'pausedUse' : 'unverified')}</p> : <PreferenceLearningPanel key={`learning:${space}:${agentId}`} agentId={agentId} space={space} confirmed={data.confirmed} revisionHint={data.revision} locale={fa ? 'fa' : 'en'} onRevision={revision => setData(current => current?.space === space ? { ...current, revision } : current)} />}
          <PreferencePanel key={`${space}:${agentId}`} agentId={agentId} space={space} confirmed={data.confirmed} revisionHint={data.revision} locale={fa ? 'fa' : 'en'} onSnapshot={value => { if (generation.current === renderGeneration) apply(value, boundary); }} productPaused={pause.status?.productPaused === true} />
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
        {data.inbox.filter(item => !pause.coveredBlocked && item.kind !== 'requested_reminder').map(item => <article className="vx-card vx-privacy-card" key={item.id}><h3 className="vx-head">{item.kind === 'requested_reminder' ? item.label : t('A reply did not finish. You can try again when convenient.', 'یک پاسخ کامل نشد. هر زمان مناسب بود می‌توانید دوباره تلاش کنید.')}</h3><div className="vx-privacy-actions"><button className="vx-btn vx-btn-secondary vx-btn-sm" disabled={busy} onClick={() => void mutate(() => experienceApi.feedback({ ...command(), itemId: item.id, action: 'useful' }))}>{t('Useful', 'مفید بود')}</button><button className="vx-btn vx-btn-secondary vx-btn-sm" disabled={busy} onClick={() => void mutate(() => experienceApi.feedback({ ...command(), itemId: item.id, action: 'dismiss' }))}>{t('Dismiss', 'بستن')}</button></div></article>)}

      </>}
      <LearningPanel space={space} locale={fa ? 'fa' : 'en'} showOperations={role === 'owner' || role === 'superadmin'} />
      {(role === 'owner' || role === 'superadmin') && <RightsOperationsPanel locale={fa ? 'fa' : 'en'} sessionKey={session} />}
    </section>
  </>;
}
