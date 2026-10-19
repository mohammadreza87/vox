'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ConnectionsDashboard } from '@/lib/connections/application';
import type { SpaceKind, ConnectionWorkflow } from '@/lib/connections/contracts';
import type { ConnectionsWorkflowService } from '@/lib/connections/workflows/service';
import type { WorkflowChoice } from '@/lib/connections/workflows/recipes';
import { connectionsApi } from '../../_lib/connections-client';
import { connectionSkillTitle, type ConnectionsLocale } from '../../_lib/connections-copy';

const copy = {
  en: { title: 'Scheduled checks', intro: 'Check selected resources on a schedule. Activity records contain status only; source content is not saved or sent to a group.',
    create: 'New check', name: 'Name', resource: 'Resource and agent', select: 'Choose…', skill: 'Task guidance', schedule: 'Schedule',
    hourly: 'Every 15 minutes', daily: 'Daily', event: 'Verified service event', time: 'Local time', zone: 'Timezone', quiet: 'Quiet hours', start: 'Start hour', end: 'End hour',
    runs: 'Maximum checks', draft: 'Save draft', review: 'Activate reviewed check', pause: 'Pause', empty: 'No checks yet.', unavailable: 'No permitted read recipe is available. Choose access first.',
    error: 'The check could not be confirmed. Refresh before trying again.', refresh: 'Refresh checks', loading: 'Loading checks…', expires: 'Access expires',
    saved: 'Draft saved. Review the details before activating.', worker: 'Checks run only while the scheduled worker is configured and access remains valid.', details: 'Exact read and schedule',
    states: { draft: 'Draft', active: 'Active', paused: 'Paused', expired: 'Expired' }, range: 'Sheet range', cancel: 'Cancel', pending: 'Working…', activity: 'Recent checks' },
  fa: { title: 'بررسی‌های زمان‌بندی‌شده', intro: 'منابع انتخاب‌شده را طبق برنامه بررسی کنید. فقط وضعیت ثبت می‌شود؛ محتوای منبع ذخیره یا به گروه ارسال نمی‌شود.',
    create: 'بررسی جدید', name: 'نام', resource: 'منبع و عامل', select: 'انتخاب…', skill: 'راهنمای کار', schedule: 'برنامه',
    hourly: 'هر ۱۵ دقیقه', daily: 'روزانه', event: 'رویداد تأییدشدهٔ سرویس', time: 'زمان محلی', zone: 'منطقهٔ زمانی', quiet: 'ساعت‌های سکوت', start: 'ساعت شروع', end: 'ساعت پایان',
    runs: 'حداکثر بررسی‌ها', draft: 'ذخیرهٔ پیش‌نویس', review: 'فعال‌کردن بررسی تأییدشده', pause: 'توقف', empty: 'هنوز بررسی‌ای وجود ندارد.', unavailable: 'بررسی مجازی در دسترس نیست. ابتدا دسترسی را انتخاب کنید.',
    error: 'بررسی تأیید نشد. پیش از تلاش دوباره تازه‌سازی کنید.', refresh: 'تازه‌سازی بررسی‌ها', loading: 'در حال دریافت بررسی‌ها…', expires: 'پایان دسترسی',
    saved: 'پیش‌نویس ذخیره شد. پیش از فعال‌کردن، جزئیات را بررسی کنید.', worker: 'بررسی‌ها فقط هنگام راه‌اندازی اجراکنندهٔ برنامه و معتبر بودن دسترسی اجرا می‌شوند.', details: 'منبع و برنامهٔ دقیق',
    states: { draft: 'پیش‌نویس', active: 'فعال', paused: 'متوقف', expired: 'منقضی' }, range: 'محدودهٔ برگه', cancel: 'لغو', pending: 'در حال انجام…', activity: 'بررسی‌های اخیر' },
} as const;
type Listing = Awaited<ReturnType<ConnectionsWorkflowService['list']>>;

export function ConnectionWorkflows({ data, space, locale, agentId }: { data: ConnectionsDashboard; space: SpaceKind; locale: ConnectionsLocale; agentId?: string }) {
  const c = copy[locale];
  const [listing, setListing] = useState<Listing | null>(null);
  const [choices, setChoices] = useState<WorkflowChoice[]>([]);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState('');
  const [name, setName] = useState('');
  const [skill, setSkill] = useState('');
  const [schedule, setSchedule] = useState('hourly');
  const [time, setTime] = useState('09:00');
  const [zone, setZone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
  const [quietStart, setQuietStart] = useState(22);
  const [quietEnabled, setQuietEnabled] = useState(false);
  const [quietEnd, setQuietEnd] = useState(8);
  const [maxRuns, setMaxRuns] = useState(20);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [saved, setSaved] = useState(false);
  const generation = useRef(0);
  const lock = useRef(false);
  const reload = async () => {
    const turn = ++generation.current;
    const [state, options] = await Promise.all([connectionsApi.workflows(space), connectionsApi.workflowChoices(space)]);
    if (turn === generation.current) { setListing(state); setChoices(options.choices.filter(choice => !agentId || choice.agentId === agentId)); }
  };
  const invalidate = useCallback(() => { generation.current++; }, []);
  useEffect(() => { void reload().catch(() => setError(true)); return invalidate; // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [space, data, agentId]);
  const act = async (run: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(false); setSaved(false);
    try { await run(); await reload(); } catch { setError(true); } finally { lock.current = false; setBusy(false); }
  };
  const choice = choices.find(item => item.id === selected);
  const skills = data.skills?.filter(item => item.providerIds.includes(choice?.providerId ?? '')) ?? [];
  const subscriptions = listing?.subscriptions.filter(s => s.status === 'active' && s.connectionId === choice?.connectionId && s.resourceId === choice.resourceId && s.expiresAt > Date.now()) ?? [];
  const expiresAt = Math.min(choice?.expiresAt ?? 0, data.maxGrantExpiryAt);
  const visible = listing?.workflows.filter(w => !agentId || w.agentId === agentId) ?? [];
  const date = (value: number) => new Date(value).toLocaleString(locale === 'fa' ? 'fa-IR' : 'en-GB');
  const reviewDetails = (workflow: ConnectionWorkflow) => ({ resource: workflow.steps.map(s => s.resourceIds), read: workflow.steps.map(s => ({ tool: s.toolId, arguments: s.arguments })),
    schedule: workflow.schedule, timezone: workflow.timezone, quietHours: workflow.quietHours, maxRuns: workflow.maxRuns, maxCalls: workflow.maxCalls, expires: date(workflow.expiresAt) });
  return <section style={{ display: 'grid', gap: 12 }} aria-busy={busy}>
    <h2 className="vx-title-m">{c.title}</h2><p className="vx-small vx-2">{c.intro}</p><p className="vx-small vx-2">{c.worker}</p>
    {error && <p role="alert" className="vx-banner danger">{c.error}<button className="vx-btn vx-btn-secondary vx-btn-sm" disabled={busy} onClick={() => void act(async () => undefined)}>{c.refresh}</button></p>}
    {saved && <p role="status" className="vx-banner info">{c.saved}</p>}
    {!listing && !error && <p role="status">{c.loading}</p>}
    {!open && <button className="vx-btn vx-btn-secondary" disabled={busy || !data.enabled || !choices.length} onClick={() => setOpen(true)}>{c.create}</button>}
    {listing && !choices.length && <p className="vx-small vx-2">{c.unavailable}</p>}
    {open && <form className="vx-card" style={{ padding: 18, display: 'grid', gap: 12 }} onSubmit={event => { event.preventDefault(); if (!choice) return; void act(async () => {
      await connectionsApi.createWorkflow({ space, name, agentId: choice.agentId, connectionId: choice.connectionId, grantId: choice.grantId, skillId: skill, skillVersion: 1,
        steps: [{ toolId: choice.toolId, arguments: { ...choice.arguments, ...fields } }],
        schedule: schedule === 'hourly' ? { kind: 'interval', minutes: 15 } : schedule === 'daily' ? { kind: 'daily', localTime: time } : { kind: 'event', subscriptionId: schedule },
        timezone: zone, quietHours: quietEnabled ? { startHour: quietStart, endHour: quietEnd } : null, expiresAt, maxRuns, maxCalls: maxRuns });
      setOpen(false); setSaved(true);
    }); }}>
      <label className="vx-small">{c.name}<input className="vx-input" required maxLength={160} disabled={busy} value={name} onChange={e => setName(e.target.value)} /></label>
      <label className="vx-small">{c.resource}<select className="vx-input" value={selected} disabled={busy} onChange={e => { setSelected(e.target.value); setSkill(''); setSchedule('hourly'); const value = choices.find(item => item.id === e.target.value); setFields(Object.fromEntries(value?.fields.map(field => [field.key, field.value]) ?? [])); }}><option value="">{c.select}</option>{choices.map(item => <option key={item.id} value={item.id}>{item.label} · {data.agents.find(a => a.id === item.agentId)?.name}</option>)}</select></label>
      {choice?.fields.map(field => <label key={field.key} className="vx-small">{field.key === 'range' ? c.range : field.label}<input className="vx-input" required type={field.type} maxLength={150} value={fields[field.key] ?? ''} disabled={busy} onChange={e => setFields({ ...fields, [field.key]: e.target.value })} /></label>)}
      <label className="vx-small">{c.skill}<select className="vx-input" value={skill} disabled={busy} onChange={e => setSkill(e.target.value)}><option value="">{c.select}</option>{skills.map(item => <option key={item.id} value={item.id}>{connectionSkillTitle(item.id, item.title, locale)} · v1</option>)}</select></label>
      <label className="vx-small">{c.schedule}<select className="vx-input" value={schedule} disabled={busy} onChange={e => setSchedule(e.target.value)}><option value="hourly">{c.hourly}</option><option value="daily">{c.daily}</option>{choice && ['github.repository.get', 'slack.channel.get'].includes(choice.toolId) && subscriptions.map(s => <option key={s.id} value={s.id}>{c.event}</option>)}</select></label>
      {schedule === 'daily' && <label className="vx-small">{c.time}<input className="vx-input" type="time" required value={time} disabled={busy} onChange={e => setTime(e.target.value)} /></label>}
      <label className="vx-small">{c.zone}<input className="vx-input" required maxLength={100} value={zone} disabled={busy} onChange={e => setZone(e.target.value)} /></label>
      <label className="vx-privacy-checkbox"><input type="checkbox" disabled={busy} checked={quietEnabled} onChange={e => setQuietEnabled(e.target.checked)} />{c.quiet}</label>
      {quietEnabled && <fieldset disabled={busy} style={{ border: 0, padding: 0, display: 'flex', gap: 12 }}><legend>{c.quiet}</legend><label className="vx-small">{c.start}<input className="vx-input" type="number" min={0} max={23} required value={quietStart} onChange={e => setQuietStart(Number(e.target.value))} /></label><label className="vx-small">{c.end}<input className="vx-input" type="number" min={0} max={23} required value={quietEnd} onChange={e => setQuietEnd(Number(e.target.value))} /></label></fieldset>}
      <label className="vx-small">{c.runs}<input className="vx-input" type="number" min={1} max={100} required value={maxRuns} disabled={busy} onChange={e => setMaxRuns(Number(e.target.value))} /></label>
      {choice && <p className="vx-small">{c.expires}: {date(expiresAt)}</p>}
      <button className="vx-btn vx-btn-primary" disabled={busy || !choice || !skill || !name.trim()}>{busy ? c.pending : c.draft}</button><button type="button" className="vx-btn vx-btn-secondary" disabled={busy} onClick={() => setOpen(false)}>{c.cancel}</button>
    </form>}
    {listing && !visible.length && <p className="vx-small vx-2">{c.empty}</p>}
    {visible.map(workflow => <article key={workflow.id} className="vx-card" style={{ padding: 18, display: 'grid', gap: 10 }}><h3 className="vx-head">{workflow.name}</h3><p className="vx-small">{c.states[workflow.status]} · {workflow.runsReserved}/{workflow.maxRuns}</p>
      <p className="vx-small">{c.expires}: {date(workflow.expiresAt)}</p><details open={workflow.status === 'draft'}><summary>{c.details}</summary><pre dir="ltr" style={{ fontSize: 12, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify(reviewDetails(workflow), null, 2)}</pre></details>
      {workflow.status === 'draft' && <button className="vx-btn vx-btn-primary" disabled={busy} onClick={() => void act(async () => { await connectionsApi.reviewWorkflow(space, workflow); })}>{c.review}</button>}
      {['active', 'draft'].includes(workflow.status) && <button className="vx-btn vx-btn-secondary" disabled={busy} onClick={() => void act(async () => { await connectionsApi.pauseWorkflow(space, workflow); })}>{c.pause}</button>}
      <details><summary>{c.activity}</summary>{listing?.occurrences.filter(o => o.workflowId === workflow.id).slice(-10).reverse().map(o => <p className="vx-small" key={o.id}>{date(o.slotAt)} · <bdi>{o.state}</bdi></p>)}</details>
    </article>)}
  </section>;
}
