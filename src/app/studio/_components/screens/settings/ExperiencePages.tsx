'use client';

import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useState } from 'react';
import type { InboxItem } from '@/lib/adaptive/runtime/contracts';
import { api, type AgentView } from '../../../_lib/client';
import { experienceApi } from '../../../_lib/experience-client';
import { DUR, EASE, SPRING } from '../../../_lib/motion';
import { pauseText } from '../../../_lib/product-pause-copy';
import { AgentFace } from '../../Cloud';
import { LearningPanel } from '../../LearningPanel';
import { PreferenceLearningPanel } from '../../PreferenceLearningPanel';
import { PreferencePanel } from '../../PreferencePanel';
import { RelationshipPanel } from '../../RelationshipPanel';
import { ReminderPanel } from '../../ReminderPanel';
import { Banner, Empty, Icon, Picker, Row, Section, Sheet, SheetHead, SkeletonRows, Switch } from '../../ui';
import { Enter, IconTile, LiveSheet, SettingsPage, SheetError, SpaceBar, Stepper, formatWhen, hourLabel, timeZones, useFirstLoad } from './kit';
import { announceInboxChange, inboxRows } from './useInboxBadge';
import { useExperience, type Experience } from './useExperience';

/** Errors with a way out: Retry reloads this page's data. */
function ErrorBanner({ x }: { x: Experience }) {
  if (!x.error) return null;
  return <Banner tone="danger" action={<button type="button" className="vx-btn vx-btn-secondary vx-btn-xs" disabled={x.busy} onClick={() => void x.load()}>{x.t('Refresh', 'تازه‌سازی')}</button>}>{x.error}</Banner>;
}

/** "For" row: the agent these choices apply to, opening a picker sheet. */
function AgentRow({ x, title }: { x: Experience; title: string }) {
  const [open, setOpen] = useState(false);
  const agent = x.agents.find(a => a.id === x.agentId);
  return <>
    <Row plain chevron disabled={x.busy || !x.agents.length} onClick={() => setOpen(true)} aria-label={`${title}: ${agent?.persona.name ?? x.t('Choose an agent', 'انتخاب عامل')}`}
      lead={agent ? <AgentFace look={agent.look} stage={agent.stage} size={32} variant="disc" still label={agent.persona.name} /> : <IconTile name="user" />}
      title={title} value={agent?.persona.name ?? x.t('Choose', 'انتخاب')} />
    <Picker open={open} onClose={() => setOpen(false)} title={x.t('Choose an agent', 'انتخاب عامل')} value={x.agentId || null} search={x.agents.length > 6}
      searchLabel={x.t('Search', 'جستجو')} empty={x.t('Nothing matches', 'موردی پیدا نشد')}
      options={x.agents.map((a: AgentView) => ({ value: a.id, label: a.persona.name, sub: a.persona.role,
        lead: <AgentFace look={a.look} stage={a.stage} size={32} variant="disc" still label={a.persona.name} /> }))}
      onChange={x.setAgentId} />
  </>;
}

/* ---------- Preferences ---------- */

/** Preferences (UI §4.12): who you are talking to, how they reply, when Vox may notify you. Every change saves itself. */
export function PreferencesPage() {
  const x = useExperience();
  const { t, fa, data, busy, settings, space } = x;
  const [sheet, setSheet] = useState<'zone' | 'quiet' | 'evidence' | null>(null);
  const first = useFirstLoad(!!data);
  const agent = x.agents.find(a => a.id === x.agentId);
  const zone = settings.timezone;
  const quiet = `${hourLabel(settings.quietStart, fa)}–${hourLabel(settings.quietEnd, fa)}`;
  return <SettingsPage title={t('Preferences', 'ترجیح‌ها')} busy={busy}>
    <SpaceBar disabled={busy} label={t('Experience space', 'فضای تجربه')} />
    <ErrorBanner x={x} />
    {!data && !x.error && <SkeletonRows rows={4} lead="tile" label={t('Loading…', 'در حال دریافت…')} />}
    {data && <>
      <Enter i={0} first={first}>
        <Section title={t('How agents reply', 'شیوهٔ پاسخ عامل‌ها')}>
          <AgentRow x={x} title={t('Agent', 'عامل')} />
        </Section>
      </Enter>
      {x.agentId && <Enter i={1} first={first} className="vx-stack-s">
        {x.pause.coveredBlocked
          ? <Banner tone="warn">{pauseText(fa ? 'fa' : 'en', space, x.pause.status?.productPaused ? 'pausedUse' : 'unverified')}</Banner>
          : <PreferenceLearningPanel key={`learning:${space}:${x.agentId}`} agentId={x.agentId} space={space} confirmed={data.confirmed} revisionHint={data.revision} locale={x.nav.locale}
            onRevision={revision => x.setData(current => current?.space === space ? { ...current, revision } : current)} />}
        <PreferencePanel key={`${space}:${x.agentId}`} agentId={x.agentId} space={space} confirmed={data.confirmed} revisionHint={data.revision} locale={x.nav.locale}
          onSnapshot={value => { if (x.generation.current === x.renderGeneration) x.apply(value, x.boundary); }} productPaused={x.pause.status?.productPaused === true} />
        {agent && typeof api.relationship === 'function' && <RelationshipPanel key={`${space}:${x.agentId}`} presentation="row" agentId={x.agentId} name={agent.persona.name}
          space={space} locale={x.nav.locale} identityConfirmed={data.confirmed} />}
      </Enter>}
      {!x.agentId && <p className="vx-footnote vx-pref-hint">{t('Choose an agent to see how it replies to you.', 'برای دیدن شیوهٔ پاسخ، یک عامل انتخاب کنید.')}</p>}

      <Enter i={2} first={first}>
        <Section title={t('Notifications', 'اعلان‌ها')} foot={t('These control your private inbox in this space. Telegram reminders have their own choice in Reminders.', 'این تنظیمات صندوق خصوصی شما در این فضا را کنترل می‌کنند. یادآور تلگرام در «یادآورها» انتخاب جداگانه دارد.')}>
          <Switch checked={settings.inbox} disabled={busy || !data.confirmed} onChange={v => void x.saveSettings({ inbox: v })}
            lead={<IconTile name="inbox" />} label={t('Enable inbox', 'فعال کردن صندوق')} sub={!data.confirmed ? t('Confirm your identity in You first', 'ابتدا هویت خود را در «شما» تأیید کنید') : undefined} />
          <Switch checked={settings.proactive} disabled={busy || (!settings.proactive && !data.capabilities.proactiveInbox)} onChange={v => void x.saveSettings({ proactive: v })}
            lead={<IconTile name="spark" />} label={t('Helpful suggestions', 'پیشنهادهای مفید')}
            sub={!settings.proactive && !data.capabilities.proactiveInbox ? t('Needs the matching permission in You', 'نیازمند اجازهٔ مربوط در «شما»') : undefined} />
          <Switch checked={settings.reminders} disabled={busy || (!settings.reminders && !data.capabilities.reminders)} onChange={v => void x.saveSettings({ reminders: v })}
            lead={<IconTile name="bell" />} label={t('Requested reminders', 'یادآورهای درخواستی')}
            sub={!settings.reminders && !data.capabilities.reminders ? t('Needs the matching permission in You', 'نیازمند اجازهٔ مربوط در «شما»') : undefined} />
        </Section>
      </Enter>

      <Enter i={3} first={first}>
        <Section title={t('Timing', 'زمان‌بندی')} foot={t('The suggestion limit applies across both spaces.', 'محدودیت پیشنهاد در مجموع هر دو فضا اعمال می‌شود.')}>
          <Row plain lead={<IconTile name="globe" />} title={t('Time zone', 'منطقهٔ زمانی')} value={zone || t('Not set', 'تنظیم نشده')} chevron disabled={busy} onClick={() => setSheet('zone')} />
          <Row plain lead={<IconTile name="clock" />} title={t('Quiet hours', 'ساعت‌های سکوت')} value={quiet} chevron disabled={busy} onClick={() => setSheet('quiet')} />
          <div className="vx-row">
            <IconTile name="sliders" />
            <span className="vx-row-main"><span className="vx-row-title plain">{t('Daily limit', 'سقف روزانه')}</span><span className="vx-row-sub">{t('Suggestions per 24 hours', 'پیشنهاد در ۲۴ ساعت')}</span></span>
            <Stepper value={settings.cap} min={0} max={20} disabled={busy} label={t('Maximum suggestions per 24 hours', 'بیشترین پیشنهاد در ۲۴ ساعت')}
              format={n => n.toLocaleString(fa ? 'fa-IR' : 'en-US')} onChange={cap => void x.saveSettings({ cap })} />
          </div>
        </Section>
      </Enter>

      <Enter i={4} first={first}>
        <Section title={t('Your data', 'داده‌های شما')}>
          <Row plain lead={<IconTile name="signal" />} title={t('Measurements and export', 'اندازه‌گیری‌ها و خروجی')} sub={t('What Vox measured in this space', 'آنچه وکس در این فضا اندازه گرفته')} chevron onClick={() => setSheet('evidence')} />
        </Section>
      </Enter>
    </>}

    <Picker open={sheet === 'zone'} onClose={() => setSheet(null)} title={t('Time zone', 'منطقهٔ زمانی')} value={zone || null} search
      searchLabel={t('Search', 'جستجو')} empty={t('Nothing matches', 'موردی پیدا نشد')}
      options={timeZones(zone).map(z => ({ value: z, label: z.replace(/_/g, ' ') }))} onChange={timezone => void x.saveSettings({ timezone })} />
    <Sheet open={sheet === 'quiet'} onClose={() => setSheet(null)} label={t('Quiet hours', 'ساعت‌های سکوت')}>
      <div className="vx-sheet-stack">
        <SheetHead title={t('Quiet hours', 'ساعت‌های سکوت')} sub={t('No suggestions or alerts between these hours, in your time zone.', 'در این بازه، در منطقهٔ زمانی شما، پیشنهاد یا اعلانی ارسال نمی‌شود.')} />
        <div className="vx-hours">
          {([['quietStart', t('Quiet hours start', 'شروع سکوت')], ['quietEnd', t('Quiet hours end', 'پایان سکوت')]] as const).map(([key, label]) => (
            <label key={key} className="vx-field"><span className="vx-label">{label}</span>
              <select className="vx-select" value={settings[key]} disabled={busy} onChange={e => void x.saveSettings({ [key]: Number(e.target.value) })}>
                {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{hourLabel(h, fa)}</option>)}
              </select>
            </label>
          ))}
        </div>
        {x.error && <SheetError>{x.error}</SheetError>}
      </div>
    </Sheet>
    <LiveSheet open={sheet === 'evidence'} scope={`${space}:${x.nav.locale}`} onClose={() => setSheet(null)} label={t('Measurements and export', 'اندازه‌گیری‌ها و خروجی')}>
      <div className="vx-sheet-stack"><LearningPanel key={space} space={space} locale={x.nav.locale} /></div>
    </LiveSheet>
  </SettingsPage>;
}

/* ---------- Inbox ---------- */

/** Inbox (UI §4.12): rows with an unread dot; actions live in the item's sheet. */
export function InboxPage() {
  const x = useExperience();
  const { t, fa, data, busy } = x;
  const reduced = useReducedMotion() || x.nav.tier === 'reduced';
  const [openId, setOpenId] = useState<string | null>(null);
  const rows = inboxRows(data, x.pause.coveredBlocked);
  const item = rows.find(r => r.id === openId) ?? null;
  const title = (i: InboxItem) => i.kind === 'requested_reminder' ? i.label : t('A reply did not finish', 'یک پاسخ کامل نشد');
  // What follows the title depends on the kind: a reminder says when it was due, a failed reply offers a retry.
  const reminder = (i: InboxItem) => i.kind === 'requested_reminder';
  const sub = (i: InboxItem) => reminder(i)
    ? t(`Reminder · due ${formatWhen(i.dueAt, fa)}`, `یادآور · موعد ${formatWhen(i.dueAt, fa)}`)
    : t('You can try again when convenient.', 'هر زمان مناسب بود می‌توانید دوباره تلاش کنید.');
  const open = (i: InboxItem) => {
    setOpenId(i.id);
    // Opening an unread notice marks it read; quietly, no toast.
    if (i.status === 'unread') void x.mutate(() => experienceApi.feedback({ ...x.command(), itemId: i.id, action: 'read' }), { quiet: true }).then(ok => { if (ok) announceInboxChange(); });
  };
  const feedback = async (i: InboxItem, action: 'useful' | 'dismiss') => {
    if (await x.mutate(() => experienceApi.feedback({ ...x.command(), itemId: i.id, action }))) { setOpenId(null); announceInboxChange(); }
  };
  const leave = reduced ? { opacity: 0, transition: { duration: DUR.fast } } : { opacity: 0, y: -16, transition: { duration: 0.32, ease: EASE.exit } };
  return <SettingsPage title={t('Inbox', 'صندوق اعلان')} busy={busy}>
    <SpaceBar disabled={busy} label={t('Experience space', 'فضای تجربه')} />
    <ErrorBanner x={x} />
    {x.pause.coveredBlocked && <Banner tone="warn">{pauseText(fa ? 'fa' : 'en', x.space, x.pause.status?.productPaused ? 'pausedUse' : 'unverified')}</Banner>}
    {!data && !x.error && <SkeletonRows rows={3} lead="tile" label={t('Loading…', 'در حال دریافت…')} />}
    {data && !rows.length && !x.pause.coveredBlocked && <Empty title={t('Nothing to show right now.', 'اکنون موردی برای نمایش نیست.')}
      body={data.settings[x.space].inboxEnabled ? t('Notices from your agents land here.', 'اعلان‌های عامل‌ها اینجا می‌آیند.') : t('The inbox is off for this space. Turn it on in Preferences.', 'صندوق در این فضا خاموش است. آن را در ترجیح‌ها روشن کنید.')}
      action={!data.settings[x.space].inboxEnabled ? <button type="button" className="vx-btn vx-btn-secondary vx-btn-sm" onClick={() => x.nav.push({ name: 'settings', page: 'preferences' })}>{t('Open Preferences', 'باز کردن ترجیح‌ها')}</button> : undefined} />}
    {!!rows.length && <Section title={t('Notices', 'اعلان‌ها')}>
      <AnimatePresence initial={false}>
        {rows.map(i => <motion.div key={i.id} className="vx-inbox-item" layout={!reduced} exit={leave} transition={SPRING.snappy}>
          <Row align="top" chevron disabled={busy} onClick={() => open(i)} aria-label={`${i.status === 'unread' ? `${t('Unread', 'خوانده‌نشده')}: ` : ''}${title(i)}`}
            lead={<span className="vx-inbox-lead">{i.status === 'unread' && <span className="vx-unread" aria-hidden="true" />}<IconTile name={i.kind === 'requested_reminder' ? 'clock' : 'bell'} /></span>}
            title={title(i)} sub={<span className="vx-clamp-2">{sub(i)}</span>}
            end={<time className="vx-inbox-time" dateTime={new Date(i.createdAt).toISOString()}>{formatWhen(i.createdAt, fa, { day: 'numeric', month: 'short' })}</time>} />
        </motion.div>)}
      </AnimatePresence>
    </Section>}
    <Section>
      <Row plain lead={<IconTile name="clock" />} title={t('Reminders', 'یادآورها')} chevron onClick={() => x.nav.push({ name: 'settings', page: 'reminders' })} />
    </Section>

    <LiveSheet open={!!item} scope={`${x.space}:${x.boundary.scope}`} onClose={() => { if (!busy) setOpenId(null); }} label={item ? title(item) ?? '' : ''}>
      {item && <div className="vx-sheet-stack">
        <SheetHead title={title(item)} sub={formatWhen(item.createdAt, fa)} />
        <p className="vx-footnote">{reminder(item)
          ? t(`A reminder you asked for, due ${formatWhen(item.dueAt, fa)}.`, `یادآوری که خواسته بودید، با موعد ${formatWhen(item.dueAt, fa)}.`)
          : t('A reply did not finish. You can try again when convenient.', 'یک پاسخ کامل نشد. هر زمان مناسب بود می‌توانید دوباره تلاش کنید.')}</p>
        <p className="vx-footnote">{t('Why this: it belongs to your private inbox in this space. Only you see it.', 'دلیل نمایش: متعلق به صندوق خصوصی شما در این فضاست و فقط شما آن را می‌بینید.')}</p>
        <div className="vx-group">
          <Row plain lead={<Icon name="check" size={20} />} title={t('Useful', 'مفید بود')} disabled={busy} onClick={() => void feedback(item, 'useful')} />
          <Row plain lead={<Icon name="close" size={20} />} title={t('Dismiss', 'بستن')} disabled={busy} onClick={() => void feedback(item, 'dismiss')} />
        </div>
        {x.error && <SheetError>{x.error}</SheetError>}
      </div>}
    </LiveSheet>
  </SettingsPage>;
}

/* ---------- Reminders ---------- */

/** Reminders (UI §4.12). `notificationId` comes from a reminder alert's deep link and highlights that row. */
export function RemindersPage({ notificationId }: { notificationId?: string }) {
  const x = useExperience(notificationId);
  const { t, fa, data, busy } = x;
  return <SettingsPage title={t('Reminders', 'یادآورها')} busy={busy}>
    <SpaceBar disabled={busy} label={t('Experience space', 'فضای تجربه')} />
    <ErrorBanner x={x} />
    {x.notificationMissing && <Banner tone="info"><span role="status">{t('This reminder is not available.', 'این یادآور در دسترس نیست.')}</span></Banner>}
    {!data && !x.error && <SkeletonRows rows={3} lead="tile" label={t('Loading…', 'در حال دریافت…')} />}
    {data && <ReminderPanel key={x.space} data={data} agentId={x.agentId} fa={fa} busy={busy} mutate={x.mutate} notificationId={notificationId}
      agentRow={<AgentRow x={x} title={t('For', 'برای')} />} error={x.error && <SheetError>{x.error}</SheetError>} />}
  </SettingsPage>;
}
