'use client';
import { useState, type ReactNode } from 'react';
import type { ExperienceSnapshot, InboxItem } from '@/lib/adaptive/runtime/contracts';
import { experienceApi } from '../_lib/experience-client';
import { Fact, LiveSheet } from './screens/settings/kit';
import { Banner, Composer, Icon, Row, Section, Sheet, SheetHead, Switch, useConfirm } from './ui';

/** Pill tone for a reminder's delivery state; the full, honest wording lives in its sheet. */
function deliveryTone(item: InboxItem) {
  const state = item.delivery?.state;
  return state === 'accepted' ? 'live' : state === 'unknown' || state === 'failed' ? 'warn' : state === 'cancelled' || !state ? '' : 'volt';
}

/** Reminders (UI §4.12): a composer for new ones, rows with a delivery pill, actions in a sheet, the Telegram channel behind one row. */
export function ReminderPanel({ data, agentId, fa, busy, mutate, notificationId, agentRow, error }: { data: ExperienceSnapshot; agentId: string; fa: boolean; busy: boolean;
  mutate: (action: () => Promise<ExperienceSnapshot>, opts?: { quiet?: boolean }) => Promise<boolean | void>; notificationId?: string;
  /** The "For" agent picker row, placed in the New reminder section */
  agentRow?: ReactNode;
  /** The page's error banner, repeated inside the Telegram sheet so a refusal is visible where it happened */
  error?: ReactNode }) {
  const [label, setLabel] = useState(''), [due, setDue] = useState(''), [exactTime, setExactTime] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null), [channelOpen, setChannelOpen] = useState(false), [hint, setHint] = useState(false);
  const confirm = useConfirm();
  const t = (en: string, persian: string) => fa ? persian : en;
  const command = () => ({ space: data.space, expectedRevision: data.revision, eventId: crypto.randomUUID() });
  const reminders = data.reminders ?? data.inbox.filter(item => item.kind === 'requested_reminder');
  const state = data.reminderTelegram;
  const date = (at: number) => { try { return new Intl.DateTimeFormat(fa ? 'fa-IR' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short', ...(data.settings.timezone ? { timeZone: data.settings.timezone } : {}) }).format(at); } catch { return new Date(at).toISOString(); } };
  const deliveryShort = (item: InboxItem) => {
    const s = item.delivery?.state;
    return !s ? t('Inbox', 'صندوق') : s === 'accepted' ? t('Sent', 'ارسال شد') : s === 'unknown' ? t('Unconfirmed', 'نامشخص')
      : s === 'failed' ? t('Not sent', 'ارسال نشد') : s === 'cancelled' ? t('Alert off', 'اعلان لغو شد') : t('Scheduled', 'برنامه‌ریزی شد');
  };
  const delivery = (item: InboxItem) => {
    const current = item.delivery;
    if (!current) return t('Inbox only.', 'فقط صندوق.');
    if (current.state === 'accepted') return t('Telegram accepted the alert. Delivery and reading are not verified.', 'تلگرام اعلان را پذیرفت. تحویل و خواندن تأیید نشده است.');
    if (current.state === 'unknown') return current.acknowledgedAt ? t('Delivery remains unknown; you have reviewed this reminder.', 'تحویل همچنان نامشخص است؛ این یادآور را بررسی کرده‌اید.') : t('Delivery is uncertain. Vox will not retry automatically. Snoozing explicitly schedules a new alert.', 'تحویل نامشخص است. وکس خودکار دوباره ارسال نمی‌کند. تعویق، اعلان تازه‌ای را با درخواست صریح شما برنامه‌ریزی می‌کند.');
    if (current.state === 'failed') return t('Telegram did not accept the alert. Snooze to request a new attempt.', 'تلگرام اعلان را نپذیرفت. برای درخواست تلاش تازه، آن را به تعویق بیندازید.');
    if (current.state === 'cancelled') return t('Telegram alert cancelled; the reminder stays in your inbox.', 'اعلان تلگرام لغو شد؛ یادآور در صندوق می‌ماند.');
    return t('Telegram alert scheduled; quiet hours and current permission apply.', 'اعلان تلگرام برنامه‌ریزی شد؛ ساعت‌های سکوت و مجوز جاری اعمال می‌شوند.');
  };
  const openItem = reminders.find(item => item.id === openId) ?? null;
  const act = async (action: () => Promise<ExperienceSnapshot>) => { if (await mutate(action) !== false) setOpenId(null); };
  const create = () => {
    if (!agentId || !due) { setHint(true); return; }
    void Promise.resolve(mutate(() => experienceApi.reminder({ ...command(), agentId, label, dueAt: new Date(due).getTime(), quietHours: exactTime ? 'allow_at_requested_time' : 'respect' })))
      .then(ok => { if (ok !== false) { setLabel(''); setDue(''); setExactTime(false); setHint(false); } });
  };
  const cancel = async (item: InboxItem) => {
    const ok = await confirm({ title: t('Cancel this reminder?', 'این یادآور لغو شود؟'), body: item.label, tone: 'danger',
      confirmLabel: t('Cancel reminder', 'لغو یادآور'), cancelLabel: t('Keep it', 'نگه داشتن') });
    if (ok) await act(() => experienceApi.reminderAction({ ...command(), itemId: item.id, action: 'cancel' }));
  };
  const closeChannel = (ok: boolean | void) => { if (ok !== false) setChannelOpen(false); };
  const channel = !state?.available ? t('Unavailable', 'در دسترس نیست') : state.renewalRequired ? t('Renewal needed', 'نیازمند تمدید') : state.enabled ? t('On', 'روشن') : t('Off', 'خاموش');
  const tools = busy || !data.capabilities.reminders;
  return <div className="vx-reminders" role="group" aria-label={t('Reminder scheduling', 'زمان‌بندی یادآور')}>
    <Section title={t('New reminder', 'یادآور تازه')} foot={t('The reminder appears in your private inbox; Telegram follows the separate choice below. An unknown time zone keeps alerts in the inbox.', 'یادآور در صندوق خصوصی نمایش داده می‌شود؛ تلگرام از انتخاب جداگانهٔ پایین پیروی می‌کند. منطقهٔ زمانی نامشخص، اعلان را در صندوق نگه می‌دارد.')}>
      {agentRow}
      <label className="vx-row vx-rem-when">
        <span className="vx-tile icon" aria-hidden="true"><Icon name="clock" size={20} /></span>
        <span className="vx-row-main">
          <span className="vx-row-title plain">{t('When', 'زمان')}</span>
          {hint && !due && <span className="vx-row-sub warn">{t('Choose a time first', 'ابتدا زمان را انتخاب کنید')}</span>}
        </span>
        <input className="vx-input vx-rem-time" type="datetime-local" value={due} disabled={tools} onChange={e => setDue(e.target.value)}
          aria-label={t('Due time (your device local time)', 'زمان مقرر (زمان محلی دستگاه)')} />
      </label>
      <Switch checked={exactTime} disabled={tools} onChange={setExactTime} label={t('Ring during quiet hours', 'زنگ در ساعت سکوت')}
        sub={t('Allow this requested reminder at its exact time during quiet hours', 'اجازهٔ این یادآور درخواستی در زمان دقیق، حتی در ساعت سکوت')} />
      <div className="vx-rem-compose">
        <Composer value={label} onChange={setLabel} onSend={create} busy={busy} maxLength={160} disabled={!data.capabilities.reminders}
          label={t('Reminder', 'یادآور')} sendLabel={t('Create reminder', 'ایجاد یادآور')} placeholder={t('Remind me…', 'یادم بینداز…')} />
        {hint && !agentId && <p className="vx-row-sub warn">{t('Choose an agent first', 'ابتدا یک عامل انتخاب کنید')}</p>}
        {!data.capabilities.reminders && <p className="vx-row-sub">{t('Reminders are off for this space. Turn on Requested reminders in Preferences.', 'یادآورها در این فضا خاموش است. «یادآورهای درخواستی» را در ترجیح‌ها روشن کنید.')}</p>}
      </div>
    </Section>

    <Section title={t('Your reminders', 'یادآورهای شما')}>
      {!reminders.length && <div className="vx-row"><span className="vx-row-sub">{t('No active reminders.', 'یادآور فعالی وجود ندارد.')}</span></div>}
      {reminders.map(item => {
        const tone = deliveryTone(item), current = notificationId === item.id;
        return <article id={`reminder-${item.id}`} tabIndex={-1} key={item.id} className="vx-rem-item" aria-current={current ? 'true' : undefined}>
          <Row align="top" chevron disabled={busy} onClick={() => setOpenId(item.id)}
            lead={<span className={`vx-tile icon${current ? ' volt' : ''}`} aria-hidden="true"><Icon name="bell" size={20} /></span>}
            title={<span className="vx-clamp-2" dir="auto">{item.label}</span>}
            sub={<>{date(item.dueAt)}{item.delivery?.state === 'unknown' && <span role="status" className="vx-rem-unknown">{delivery(item)}</span>}</>}
            end={<span className={`vx-pill${tone ? ` ${tone}` : ''}`}>{deliveryShort(item)}</span>} />
        </article>;
      })}
    </Section>

    <Section title={t('Telegram reminders', 'یادآورهای تلگرام')} foot={t('Only a generic alert and an opaque reference leave Vox; reminder details stay in your authenticated inbox.', 'فقط اعلان عمومی و شناسهٔ بی‌معنا از وکس خارج می‌شود؛ جزئیات در صندوق احراز هویت‌شده می‌ماند.')}>
      <Row plain lead={<span className="vx-tile icon" aria-hidden="true"><Icon name="send" size={20} /></span>} title={t('Telegram alerts', 'اعلان تلگرام')}
        sub={state?.renewalRequired ? t('Review and renew before the next alert', 'پیش از اعلان بعدی، بررسی و تمدید کنید') : state?.expiresAt ? `${t('Until', 'تا')} ${date(state.expiresAt)}` : undefined}
        subTone={state?.renewalRequired ? 'warn' : undefined} value={channel} chevron onClick={() => setChannelOpen(true)} />
    </Section>

    <LiveSheet open={!!openItem} scope={data.space} onClose={() => { if (!busy) setOpenId(null); }} label={t('Reminder', 'یادآور')}>
      {openItem && <div className="vx-sheet-stack">
        <span className="vx-over">{t('Reminder', 'یادآور')} · {date(openItem.dueAt)}</span>
        <p className="vx-you-note-text" dir="auto">{openItem.label}</p>
        <Banner tone={openItem.delivery?.state === 'unknown' || openItem.delivery?.state === 'failed' ? 'warn' : 'info'}>{delivery(openItem)}</Banner>
        <p className="vx-footnote">{t('Why this: you created this reminder for this agent and space.', 'دلیل نمایش: این یادآور را برای همین عامل و فضا ساخته‌اید.')}</p>
        <div className="vx-group">
          <Row plain lead={<Icon name="clock" size={20} />} title={t('Snooze 15 minutes', 'تعویق ۱۵ دقیقه')} disabled={busy}
            onClick={() => void act(() => experienceApi.reminderAction({ ...command(), itemId: openItem.id, action: 'snooze', dueAt: Date.now() + 15 * 60_000 }))} />
          {openItem.delivery?.state === 'unknown' && !openItem.delivery.acknowledgedAt && <Row plain lead={<Icon name="check" size={20} />} title={t('I have reviewed this reminder', 'این یادآور را بررسی کردم')} disabled={busy}
            onClick={() => void act(() => experienceApi.reminderAction({ ...command(), itemId: openItem.id, action: 'acknowledge_unknown' }))} />}
        </div>
        <div className="vx-group">
          <Row tone="danger" lead={<Icon name="trash" size={20} />} title={t('Cancel reminder', 'لغو یادآور')} disabled={busy} onClick={() => void cancel(openItem)} />
        </div>
        {error}
      </div>}
    </LiveSheet>

    <Sheet open={channelOpen} onClose={() => setChannelOpen(false)} label={t('Telegram reminders', 'یادآورهای تلگرام')}
      dock={state?.disclosure
        ? <button type="button" className="vx-btn vx-btn-primary vx-btn-block" disabled={busy}
          onClick={() => void Promise.resolve(mutate(() => experienceApi.reminderChannel({ ...command(), enabled: true, receipt: state.disclosure!.receipt, disclosureVersion: state.disclosure!.version }))).then(closeChannel)}>
          {t('Allow generic alerts for up to 30 days', 'اجازهٔ اعلان عمومی تا ۳۰ روز')}</button>
        : <button type="button" className="vx-btn vx-btn-secondary vx-btn-block" disabled={busy || !state?.available}
          onClick={() => void mutate(() => experienceApi.reminderChannelPresent(command()), { quiet: true })}>
          {state?.enabled || state?.renewalRequired ? t('Review 30-day renewal', 'بررسی تمدید ۳۰ روزه') : t('Review Telegram reminder choice', 'بررسی انتخاب یادآور تلگرام')}</button>}>
      <div className="vx-sheet-stack">
        <SheetHead title={t('Telegram reminders', 'یادآورهای تلگرام')} sub={channel} />
        {!state?.connected && <Banner tone="info">{t('First send a private message to VoxxBot, then refresh. Opening the app alone does not authorize a Telegram recipient.', 'ابتدا یک پیام خصوصی به VoxxBot بفرستید و سپس تازه‌سازی کنید. باز کردن برنامه به‌تنهایی گیرندهٔ تلگرام را تأیید نمی‌کند.')}</Banner>}
        {!state?.available && <Banner tone="warn">{t('Telegram reminders are unavailable until the server release, reminder permission and private recipient are ready. Inbox reminders remain separate.', 'یادآور تلگرام تا آماده شدن انتشار سرور، مجوز یادآور و گیرندهٔ خصوصی در دسترس نیست. یادآور صندوق جداست.')}</Banner>}
        {state?.renewalRequired && <Banner tone="warn"><span role="status">{t('Review and renew Telegram authorization before scheduling another alert, or turn Telegram reminders off for inbox-only reminders.', 'پیش از برنامه‌ریزی اعلان تازه، مجوز تلگرام را بررسی و تمدید کنید؛ یا برای یادآور فقط در صندوق، تلگرام را خاموش کنید.')}</span></Banner>}
        {state?.expiresAt && <div className="vx-group"><Fact label={t('Generic alert authorization ends', 'پایان مجوز اعلان عمومی')}>{date(state.expiresAt)}</Fact></div>}
        <div className="vx-you-notice">{t('A separate choice for new reminders in this space. It can work while the app is closed when the server scheduler is enabled. It permits only generic alerts for reminders you request in this space for up to 30 days while you are away. It does not extend private access or renew automatically. Current permission, recipient, time zone and quiet hours still apply. Reminders past the displayed end require renewal. Renewal keeps already scheduled, currently permitted alerts; inbox-only or uncertain alerts are not armed.', 'انتخابی جدا برای یادآورهای تازه در این فضا. با فعال بودن زمان‌بند سرور، هنگام بسته بودن برنامه هم کار می‌کند. این انتخاب فقط اعلان عمومیِ یادآورهایی را که در این فضا درخواست می‌کنید، تا ۳۰ روز هنگام نبودنتان مجاز می‌کند. دسترسی خصوصی را تمدید نمی‌کند و خودکار تمدید نمی‌شود. مجوز جاری، گیرنده، منطقهٔ زمانی و ساعت سکوت همچنان اعمال می‌شوند. یادآور پس از پایان نمایش‌داده‌شده به تمدید نیاز دارد. تمدید، اعلان‌های برنامه‌ریزی‌شده با مجوز جاری را نگه می‌دارد؛ یادآور فقط در صندوق یا با تحویل نامشخص فعال نمی‌شود.')}</div>
        {state?.disclosure && <p className="vx-footnote" role="group" aria-label={t('Confirm reminder authorization', 'تأیید مجوز یادآور')}>{t('Confirm this separate, time-limited reminder choice. You can turn it off at any time.', 'این انتخاب جداگانه و مدت‌دار یادآور را تأیید کنید. هر زمان می‌توانید آن را خاموش کنید.')}</p>}
        {(state?.enabled || state?.renewalRequired) && <div className="vx-group">
          <Row tone="danger" lead={<Icon name="close" size={20} />} title={t('Turn Telegram reminders off', 'خاموش کردن یادآور تلگرام')} disabled={busy}
            onClick={() => void Promise.resolve(mutate(() => experienceApi.reminderChannel({ ...command(), enabled: false }))).then(closeChannel)} />
        </div>}
        {error}
      </div>
    </Sheet>
  </div>;
}
