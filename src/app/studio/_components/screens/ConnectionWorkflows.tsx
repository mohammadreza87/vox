'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ConnectionsDashboard } from '@/lib/connections/application';
import type { SpaceKind, ConnectionWorkflow } from '@/lib/connections/contracts';
import type { ConnectionsWorkflowService } from '@/lib/connections/workflows/service';
import type { WorkflowChoice } from '@/lib/connections/workflows/recipes';
import { connectionsApi } from '../../_lib/connections-client';
import { connectionSkillTitle, type ConnectionsLocale } from '../../_lib/connections-copy';
import { haptic } from '../../_lib/haptics';
import { Banner, Icon, Picker, Row, Seg, Sheet, SheetHead, SkeletonRows, Switch } from '../ui';
import { Fact, IconTile, SheetError, Stepper, formatWhen, hourLabel, timeZones } from './settings/kit';

const copy = {
  en: { title: 'Scheduled checks', intro: 'Check selected resources on a schedule. Activity records contain status only; source content is not saved or sent to a group.',
    create: 'New check', name: 'Name', resource: 'Resource and agent', select: 'Choose…', skill: 'Task guidance', schedule: 'Schedule',
    hourly: 'Every 15 minutes', daily: 'Daily', event: 'Verified service event', time: 'Local time', zone: 'Timezone', quiet: 'Quiet hours', start: 'Start hour', end: 'End hour',
    runs: 'Maximum checks', draft: 'Save draft', review: 'Activate reviewed check', pause: 'Pause', empty: 'No checks yet.', unavailable: 'No permitted read recipe is available. Choose access first.',
    error: 'The check could not be confirmed. Refresh before trying again.', refresh: 'Refresh checks', loading: 'Loading checks…', expires: 'Access expires',
    saved: 'Draft saved. Review the details before activating.', worker: 'Checks run only while the scheduled worker is configured and access remains valid.', details: 'Exact read and schedule',
    states: { draft: 'Draft', active: 'Active', paused: 'Paused', expired: 'Expired' }, range: 'Sheet range', cancel: 'Cancel', pending: 'Working…', activity: 'Recent checks',
    read: 'Reads', off: 'Off', none: 'No checks have run yet.', search: 'Search' },
  fa: { title: 'بررسی‌های زمان‌بندی‌شده', intro: 'منابع انتخاب‌شده را طبق برنامه بررسی کنید. فقط وضعیت ثبت می‌شود؛ محتوای منبع ذخیره یا به گروه ارسال نمی‌شود.',
    create: 'بررسی جدید', name: 'نام', resource: 'منبع و عامل', select: 'انتخاب…', skill: 'راهنمای کار', schedule: 'برنامه',
    hourly: 'هر ۱۵ دقیقه', daily: 'روزانه', event: 'رویداد تأییدشدهٔ سرویس', time: 'زمان محلی', zone: 'منطقهٔ زمانی', quiet: 'ساعت‌های سکوت', start: 'ساعت شروع', end: 'ساعت پایان',
    runs: 'حداکثر بررسی‌ها', draft: 'ذخیرهٔ پیش‌نویس', review: 'فعال‌کردن بررسی تأییدشده', pause: 'توقف', empty: 'هنوز بررسی‌ای وجود ندارد.', unavailable: 'بررسی مجازی در دسترس نیست. ابتدا دسترسی را انتخاب کنید.',
    error: 'بررسی تأیید نشد. پیش از تلاش دوباره تازه‌سازی کنید.', refresh: 'تازه‌سازی بررسی‌ها', loading: 'در حال دریافت بررسی‌ها…', expires: 'پایان دسترسی',
    saved: 'پیش‌نویس ذخیره شد. پیش از فعال‌کردن، جزئیات را بررسی کنید.', worker: 'بررسی‌ها فقط هنگام راه‌اندازی اجراکنندهٔ برنامه و معتبر بودن دسترسی اجرا می‌شوند.', details: 'منبع و برنامهٔ دقیق',
    states: { draft: 'پیش‌نویس', active: 'فعال', paused: 'متوقف', expired: 'منقضی' }, range: 'محدودهٔ برگه', cancel: 'لغو', pending: 'در حال انجام…', activity: 'بررسی‌های اخیر',
    read: 'خواندن', off: 'خاموش', none: 'هنوز بررسی‌ای اجرا نشده است.', search: 'جستجو' },
} as const;
type Listing = Awaited<ReturnType<ConnectionsWorkflowService['list']>>;
const STATE_TONE = { draft: 'volt', active: 'live', paused: 'warn', expired: '' } as const;

/** Scheduled read-only checks (UI §4.13): rows, a details sheet with the exact read behind a disclosure, and a picker-based form. */
export function ConnectionWorkflows({ data, space, locale, agentId }: { data: ConnectionsDashboard; space: SpaceKind; locale: ConnectionsLocale; agentId?: string }) {
  const c = copy[locale], fa = locale === 'fa';
  const [listing, setListing] = useState<Listing | null>(null);
  const [choices, setChoices] = useState<WorkflowChoice[]>([]);
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState<string | null>(null);
  const [picking, setPicking] = useState<'choice' | 'skill' | 'zone' | null>(null);
  const [selected, setSelected] = useState('');
  const [name, setName] = useState('');
  const [skill, setSkill] = useState('');
  const [schedule, setSchedule] = useState('hourly');
  const [time, setTime] = useState('09:00');
  const [zone, setZone] = useState(() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; } });
  const [quietStart, setQuietStart] = useState(22);
  const [quietEnabled, setQuietEnabled] = useState(false);
  const [quietEnd, setQuietEnd] = useState(8);
  const [maxRuns, setMaxRuns] = useState(20);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
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
    if (lock.current) return false;
    lock.current = true; setBusy(true); setError(false);
    try { await run(); await reload(); return true; } catch { haptic.error(); setError(true); return false; } finally { lock.current = false; setBusy(false); }
  };
  const choice = choices.find(item => item.id === selected);
  const skills = data.skills?.filter(item => item.providerIds.includes(choice?.providerId ?? '')) ?? [];
  const subscriptions = listing?.subscriptions.filter(s => s.status === 'active' && s.connectionId === choice?.connectionId && s.resourceId === choice.resourceId && s.expiresAt > Date.now()) ?? [];
  const expiresAt = Math.min(choice?.expiresAt ?? 0, data.maxGrantExpiryAt);
  const visible = listing?.workflows.filter(w => !agentId || w.agentId === agentId) ?? [];
  const workflow = visible.find(w => w.id === shown) ?? null;
  const date = (value: number) => formatWhen(value, fa);
  const agent = (id: string) => data.agents.find(a => a.id === id)?.name ?? id;
  const skillName = (id: string) => { const s = data.skills?.find(item => item.id === id); return s ? `${connectionSkillTitle(s.id, s.title, locale)} · v1` : c.select; };
  const scheduleText = (w: ConnectionWorkflow) => w.schedule.kind === 'interval' ? c.hourly : w.schedule.kind === 'daily' ? `${c.daily} · ${w.schedule.localTime}` : c.event;
  const reviewDetails = (w: ConnectionWorkflow) => ({ resource: w.steps.map(s => s.resourceIds), read: w.steps.map(s => ({ tool: s.toolId, arguments: s.arguments })),
    schedule: w.schedule, timezone: w.timezone, quietHours: w.quietHours, maxRuns: w.maxRuns, maxCalls: w.maxCalls, expires: date(w.expiresAt) });
  const eventSchedules = choice && ['github.repository.get', 'slack.channel.get'].includes(choice.toolId) ? subscriptions : [];
  const startNew = () => { setSelected(''); setName(''); setSkill(''); setSchedule('hourly'); setFields({}); setQuietEnabled(false); setMaxRuns(20); setOpen(true); };
  const ready = !!choice && !!skill && !!name.trim() && (choice?.fields ?? []).every(f => !!fields[f.key]?.trim()) && (schedule !== 'daily' || !!time);
  const save = () => choice && act(async () => {
    await connectionsApi.createWorkflow({ space, name, agentId: choice.agentId, connectionId: choice.connectionId, grantId: choice.grantId, skillId: skill, skillVersion: 1,
      steps: [{ toolId: choice.toolId, arguments: { ...choice.arguments, ...fields } }],
      schedule: schedule === 'hourly' ? { kind: 'interval', minutes: 15 } : schedule === 'daily' ? { kind: 'daily', localTime: time } : { kind: 'event', subscriptionId: schedule },
      timezone: zone, quietHours: quietEnabled ? { startHour: quietStart, endHour: quietEnd } : null, expiresAt, maxRuns, maxCalls: maxRuns });
  }).then(ok => { if (ok) { haptic.success(); setOpen(false); } });
  return <section className="vx-section vx-flows" aria-busy={busy} aria-labelledby="vx-flows-title">
    <div className="vx-section-head"><h2 className="vx-over" id="vx-flows-title">{c.title}</h2></div>
    {error && <Banner tone="danger" action={<button type="button" className="vx-btn vx-btn-secondary vx-btn-xs" disabled={busy} onClick={() => void act(async () => undefined)}>{c.refresh}</button>}>{c.error}</Banner>}
    {!listing && !error && <SkeletonRows rows={2} lead="tile" label={c.loading} />}
    {listing && <div className="vx-group">
      {visible.map(w => <Row key={w.id} size="l" chevron lead={<IconTile name="clock" />} title={w.name} onClick={() => setShown(w.id)} aria-label={w.name}
        sub={`${c.states[w.status]} · ${w.runsReserved}/${w.maxRuns}`} end={<span className={`vx-pill ${STATE_TONE[w.status]}`}>{c.states[w.status]}</span>} />)}
      {!visible.length && <div className="vx-row"><span className="vx-row-sub">{c.empty}</span></div>}
      <Row plain lead={<span className="vx-tile icon vx-tile-add" aria-hidden="true"><Icon name="plus" size={20} /></span>} title={c.create}
        sub={!choices.length ? c.unavailable : undefined} disabled={busy || !data.enabled || !choices.length} onClick={startNew} />
    </div>}
    <p className="vx-section-foot">{c.intro} {c.worker}</p>

    <Sheet open={!!workflow} onClose={() => { if (!busy) setShown(null); }} label={workflow?.name ?? c.title}
      dock={workflow && (workflow.status === 'draft' || workflow.status === 'active') && <div className="vx-dock-row">
        <button type="button" className="vx-btn vx-btn-secondary" disabled={busy} onClick={() => void act(async () => { await connectionsApi.pauseWorkflow(space, workflow); })}>{c.pause}</button>
        {workflow.status === 'draft' && <button type="button" className="vx-btn vx-btn-primary" disabled={busy} onClick={() => void act(async () => { await connectionsApi.reviewWorkflow(space, workflow); haptic.success(); })}>{c.review}</button>}
      </div>}>
      {workflow && <div className="vx-sheet-stack">
        <SheetHead title={workflow.name} sub={<span className={`vx-pill ${STATE_TONE[workflow.status]}`}>{c.states[workflow.status]} · {workflow.runsReserved}/{workflow.maxRuns}</span>} />
        {workflow.status === 'draft' && <Banner tone="info">{c.saved}</Banner>}
        <div className="vx-group">
          <Fact label={c.resource}>{agent(workflow.agentId)}</Fact>
          <Fact label={c.read}>{workflow.steps.map(s => data.providers.flatMap(p => p.tools).find(t => t.id === s.toolId)?.name ?? s.toolId).join(', ')}</Fact>
          <Fact label={c.skill}>{skillName(workflow.skillId)}</Fact>
          <Fact label={c.schedule}>{scheduleText(workflow)}</Fact>
          <Fact label={c.zone}>{workflow.timezone}</Fact>
          <Fact label={c.quiet}>{workflow.quietHours ? `${hourLabel(workflow.quietHours.startHour, fa)}–${hourLabel(workflow.quietHours.endHour, fa)}` : c.off}</Fact>
          <Fact label={c.runs}>{workflow.maxRuns.toLocaleString(fa ? 'fa-IR' : 'en-US')}</Fact>
          <Fact label={c.expires}>{date(workflow.expiresAt)}</Fact>
        </div>
        <details className="vx-disclosure"><summary>{c.details}</summary><pre className="vx-code" dir="ltr">{JSON.stringify(reviewDetails(workflow), null, 2)}</pre></details>
        <details className="vx-disclosure"><summary>{c.activity}</summary>
          {(listing?.occurrences.filter(o => o.workflowId === workflow.id).slice(-10).reverse() ?? []).map(o => <p className="vx-footnote" key={o.id}>{date(o.slotAt)} · <bdi>{o.state.replace(/_/g, ' ')}</bdi></p>)}
          {!listing?.occurrences.some(o => o.workflowId === workflow.id) && <p className="vx-footnote">{c.none}</p>}
        </details>
        {error && <SheetError>{c.error}</SheetError>}
      </div>}
    </Sheet>

    <Sheet open={open} onClose={() => { if (!busy) setOpen(false); }} label={c.create}
      dock={<button type="button" className="vx-btn vx-btn-primary vx-btn-block" disabled={busy || !ready} onClick={() => void save()}>{busy ? c.pending : c.draft}</button>}>
      <div className="vx-sheet-stack">
        <SheetHead title={c.create} sub={c.intro} />
        <label className="vx-field"><span className="vx-label">{c.name}</span>
          <input className="vx-input" required maxLength={160} disabled={busy} value={name} onChange={e => setName(e.target.value)} dir="auto" /></label>
        <div className="vx-group">
          <Row plain lead={<IconTile name="plug" />} title={c.resource} value={choice ? `${choice.label} · ${agent(choice.agentId)}` : c.select} chevron disabled={busy}
            onClick={() => setPicking('choice')} aria-label={`${c.resource}: ${choice ? choice.label : c.select}`} />
          {choice?.fields.map(field => <label key={field.key} className="vx-row vx-flow-field">
            <span className="vx-row-main"><span className="vx-row-title plain">{field.key === 'range' ? c.range : field.label}</span></span>
            <input className="vx-input" required type={field.type} maxLength={150} value={fields[field.key] ?? ''} disabled={busy} dir="ltr"
              onChange={e => setFields({ ...fields, [field.key]: e.target.value })} aria-label={field.key === 'range' ? c.range : field.label} />
          </label>)}
          <Row plain lead={<IconTile name="spark" />} title={c.skill} value={skill ? skillName(skill) : c.select} chevron disabled={busy || !choice || !skills.length}
            onClick={() => setPicking('skill')} aria-label={`${c.skill}: ${skill ? skillName(skill) : c.select}`} />
        </div>
        <section className="vx-section"><div className="vx-section-head"><h3 className="vx-over">{c.schedule}</h3></div>
          <Seg label={c.schedule} value={schedule} onChange={setSchedule} disabled={busy}
            options={[{ value: 'hourly', label: c.hourly }, { value: 'daily', label: c.daily }, ...eventSchedules.slice(0, 1).map(s => ({ value: s.id, label: c.event }))]} />
        </section>
        <div className="vx-group">
          {schedule === 'daily' && <label className="vx-row vx-flow-field">
            <IconTile name="clock" /><span className="vx-row-main"><span className="vx-row-title plain">{c.time}</span></span>
            <input className="vx-input vx-flow-time" type="time" required value={time} disabled={busy} onChange={e => setTime(e.target.value)} aria-label={c.time} />
          </label>}
          <Row plain lead={<IconTile name="globe" />} title={c.zone} value={zone} chevron disabled={busy} onClick={() => setPicking('zone')} />
          <Switch checked={quietEnabled} onChange={setQuietEnabled} disabled={busy} label={c.quiet} lead={<IconTile name="bell" />}
            sub={quietEnabled ? `${hourLabel(quietStart, fa)}–${hourLabel(quietEnd, fa)}` : c.off} />
          {quietEnabled && <div className="vx-row vx-hours">
            {([[c.start, quietStart, setQuietStart], [c.end, quietEnd, setQuietEnd]] as const).map(([label, value, set]) => <label key={label} className="vx-field"><span className="vx-label">{label}</span>
              <select className="vx-select" value={value} disabled={busy} onChange={e => set(Number(e.target.value))}>
                {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{hourLabel(h, fa)}</option>)}
              </select></label>)}
          </div>}
          <div className="vx-row">
            <IconTile name="sliders" /><span className="vx-row-main"><span className="vx-row-title plain">{c.runs}</span></span>
            <Stepper value={maxRuns} min={1} max={100} onChange={setMaxRuns} disabled={busy} label={c.runs} />
          </div>
        </div>
        {choice && <p className="vx-footnote">{c.expires}: {date(expiresAt)}</p>}
        {error && <SheetError>{c.error}</SheetError>}
      </div>
    </Sheet>
      <Picker open={picking === 'choice'} onClose={() => setPicking(null)} title={c.resource} value={selected || null} search={choices.length > 6} searchLabel={c.search}
        options={choices.map(item => ({ value: item.id, label: item.label, sub: agent(item.agentId) }))}
        onChange={id => { setSelected(id); setSkill(''); setSchedule('hourly'); const value = choices.find(item => item.id === id); setFields(Object.fromEntries(value?.fields.map(f => [f.key, f.value]) ?? [])); }} />
      <Picker open={picking === 'skill'} onClose={() => setPicking(null)} title={c.skill} value={skill || null}
        options={skills.map(item => ({ value: item.id, label: `${connectionSkillTitle(item.id, item.title, locale)} · v1` }))} onChange={setSkill} />
      <Picker open={picking === 'zone'} onClose={() => setPicking(null)} title={c.zone} value={zone} search searchLabel={c.search}
        options={timeZones(zone).map(z => ({ value: z, label: z.replace(/_/g, ' ') }))} onChange={setZone} />
  </section>;
}
