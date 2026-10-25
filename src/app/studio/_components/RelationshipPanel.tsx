'use client';

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useProductPause } from '../_lib/product-pause-client';
import { pauseText } from '../_lib/product-pause-copy';
import { api, tg, type RelationshipSpace, type RelationshipView } from '../_lib/client';
import { haptic } from '../_lib/haptics';
import { Banner, Icon, Row, Section, Seg, Spinner, Switch } from './ui';
import { LiveSheet } from './screens/settings/kit';

type UseBoundary = Readonly<{ scope: string; accountId?: string; useEpoch: number | null | undefined; blocked: boolean; phase: string | undefined }>;
type Props = { agentId: string; name: string; space?: RelationshipSpace; locale?: 'en' | 'fa'; identityConfirmed?: boolean;
  /** inline: the controls in place (settings pages). row: one "Staying in touch" row that opens them in a sheet (Memories). */
  presentation?: 'inline' | 'row';
  /** Settings v2 splits the panel: check-ins on the agent's Permissions page, the Telegram alert on its Notifications page. */
  part?: 'all' | 'checkins' | 'alerts';
  /** Say under the alert switch that it covers every agent in this space (it is stored per space, not per agent).
   *  part 'alerts' already says so in its heading, so the note is left out there. */
  allAgentsNote?: boolean };
export function RelationshipPanel({ agentId, name, space = 'work', locale = 'en', identityConfirmed = false, presentation = 'inline', part = 'all', allAgentsNote = false }: Props) {
  const headingId = useId();
  const [open, setOpen] = useState(false);
  const session = tg()?.initData ?? '';
  const pause = useProductPause(space, session);
  const blocked = pause.coveredBlocked;
  // Account changes invalidate primary scope; first account binding still refers
  // to the same signed session and must not hide already loaded management data.
  const owner = useRef({ session, accountId: pause.status?.accountId, generation: 0 });
  if (owner.current.session !== session) owner.current = { session, accountId: pause.status?.accountId, generation: 0 };
  if (pause.status?.accountId) {
    if (owner.current.accountId && owner.current.accountId !== pause.status.accountId) owner.current.generation++;
    owner.current.accountId = pause.status.accountId;
  }
  const scope = JSON.stringify([session, space, agentId, owner.current.generation]);
  const accountId = owner.current.accountId, useEpoch = pause.status?.useEpoch, phase = pause.phase;
  const boundary = useMemo<UseBoundary>(() => Object.freeze({ scope, accountId, useEpoch, blocked, phase }), [scope, accountId, useEpoch, blocked, phase]);
  const currentUse = useRef(boundary); currentUse.current = boundary;
  const admission = useRef({ scope, waiting: blocked && pause.status?.productPaused !== true });
  if (admission.current.scope !== scope) admission.current = { scope, waiting: blocked && pause.status?.productPaused !== true };
  const [stored, setStored] = useState<{ scope: string; value: RelationshipView; use: UseBoundary } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(false);
  const [confirmForget, setConfirmForget] = useState(false);
  const sequence = useRef(0);
  const value = stored?.scope === scope ? stored.use === boundary && !blocked ? stored.value : { ...stored.value, inbox: [] } : null;
  const fa = locale === 'fa';
  const t = (en: string, persian: string) => fa ? persian : en;

  const load = useCallback(async () => {
    const requestedUse = currentUse.current;
    if (requestedUse.scope !== scope) return;
    const current = ++sequence.current;
    setError(''); setLoading(true);
    try {
      const { relationship } = await api.relationship(agentId, space);
      if (sequence.current !== current || requestedUse.scope !== currentUse.current.scope || relationship.space !== space) return;
      const permitted = requestedUse === currentUse.current && !currentUse.current.blocked;
      setStored({ scope, use: requestedUse, value: permitted ? relationship : { ...relationship, inbox: [] } });
    } catch (e) { if (sequence.current === current) setError(e instanceof Error ? e.message : 'Something went wrong'); }
    finally { if (sequence.current === current) setLoading(false); }
  }, [agentId, space, scope]);
  useEffect(() => {
    setStored(null); setBusy(false); setConfirmForget(false); void load();
    // Scope generation is independent of the use boundary. A use change keeps
    // the response's primary settings/sources but cannot admit its derived rows.
    // Cleanup invalidates the live scalar request generation, not a DOM ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return () => { sequence.current++; };
  }, [load]);
  useEffect(() => {
    if (pause.phase === 'loading' && pause.status?.productPaused !== true) admission.current.waiting = true;
    if (admission.current.waiting && !blocked && !busy) {
      admission.current.waiting = false;
      void load(); // Reacquire after status verification; never relabel an old payload.
    }
  }, [blocked, busy, load, pause.phase, pause.status?.productPaused]);
  useLayoutEffect(() => {
    setStored(current => current && current.use !== boundary ? { ...current, value: { ...current.value, inbox: [] } } : current);
  }, [boundary]);

  const update = async (input: Parameters<typeof api.updateRelationship>[1]) => {
    if (busy || currentUse.current.blocked && (input.action === 'read' || input.action === 'dismiss' || input.action === 'resume' || input.action === 'external' && input.enabled)) return;
    const current = sequence.current, requestedUse = currentUse.current;
    setBusy(true); setError('');
    try {
      const { relationship } = await Promise.resolve().then(() => api.updateRelationship(agentId, { ...input, space }, space));
      if (sequence.current === current && requestedUse.scope === currentUse.current.scope && relationship.space === space) {
        const permitted = requestedUse === currentUse.current && !currentUse.current.blocked;
        setStored({ scope, use: requestedUse, value: permitted ? relationship : { ...relationship, inbox: [] } }); setConfirmForget(false);
      }
    } catch (e) { if (sequence.current === current) setError(e instanceof Error ? e.message : 'Something went wrong'); }
    finally { if (sequence.current === current) setBusy(false); }
  };

  const stopped = !!value?.disabled;
  const paused = !!value?.pausedUntil && Date.parse(value.pausedUntil) > Date.now();
  const available = !!value?.available && value.mode !== 'off';
  const allowManage = !!value;
  const mode: 'active' | 'paused' | 'off' = stopped ? 'off' : paused ? 'paused' : 'active';
  const modeLabel = { active: t('Active', 'فعال'), paused: t('Paused', 'مکث'), off: t('Off', 'خاموش') };
  const summary = !value ? (error ? t('Couldn’t load', 'دریافت نشد') : t('Loading…', 'در حال دریافت…')) : !available ? t('Unavailable', 'در دسترس نیست') : modeLabel[mode];
  const choose = (next: typeof mode) => {
    if (next === mode) return;
    if (next === 'active') { if (!available || blocked) { haptic.error(); return; } void update({ action: 'resume' }); }
    else if (next === 'paused') void update({ action: 'pause', until: new Date(Date.now() + 7 * 86_400_000).toISOString() });
    else void update({ action: 'stop' });
  };
  const pauseReason = pauseText(locale, space, pause.status?.productPaused ? 'pausedUse' : 'unverified');
  const body = <section className="vx-rel" dir={fa ? 'rtl' : 'ltr'} lang={fa ? 'fa' : 'en'} aria-labelledby={headingId} aria-busy={busy || loading}>
    <div className="vx-rel-head">
      <div className="vx-rel-title">
        <h2 id={headingId} className="vx-title-m">{part === 'alerts' ? t('Check-in alerts', 'اعلان بررسی‌ها') : t('Staying in touch', 'در ارتباط ماندن')}</h2>
        <p className="vx-small vx-2">{part === 'alerts'
          ? t(`One switch for every agent in your ${space} space, ${name} included.`, `یک کلید برای همهٔ عامل‌های فضای ${space === 'work' ? 'کاری' : 'شخصی'} شما، از جمله ${name}.`)
          : t(`Manage ${name}’s follow-ups and private check-ins in your ${space} space.`, `پیگیری‌ها و بررسی‌های خصوصی ${name} را در فضای ${space === 'work' ? 'کاری' : 'شخصی'} مدیریت کنید.`)}</p>
      </div>
      <button type="button" className="vx-icon-btn" aria-label={t('Refresh relationship settings', 'تازه‌سازی تنظیمات ارتباط')} disabled={busy || loading} onClick={() => void load()}>
        {loading ? <Spinner size={18} /> : <Icon name="refresh" size={20} />}</button>
    </div>
    {!value && !error && <p className="vx-footnote" role="status">{t('Loading relationship settings…', 'در حال دریافت تنظیمات ارتباط…')}</p>}
    {error && <Banner tone="danger">{error}</Banner>}
    {value && <>
      {part !== 'alerts' && <div className="vx-section">
        <Seg label={t('Follow-ups', 'پیگیری‌ها')} value={mode} disabled={busy} onChange={choose}
          options={[{ value: 'active', label: modeLabel.active }, { value: 'paused', label: paused ? modeLabel.paused : t('Pause 7 days', 'مکث ۷ روزه') }, { value: 'off', label: modeLabel.off }]} />
        <p className="vx-section-foot"><span role="status">{!available ? t('Follow-ups are unavailable in this space. You can still pause, stop, or clear existing context.', 'پیگیری در این فضا در دسترس نیست. همچنان می‌توانید آن را متوقف یا مکث کنید یا زمینهٔ موجود را پاک کنید.') : paused ? t('Follow-ups are paused.', 'پیگیری‌ها مکث شده‌اند.') : stopped ? t('Follow-ups are stopped.', 'پیگیری‌ها متوقف شده‌اند.') : t('Follow-ups are available for useful open conversations.', 'پیگیری برای گفتگوهای باز و مفید در دسترس است.')}</span>
          {' '}<span>{t('Resuming does not grant memory or notification permissions.', 'ازسرگیری، مجوز حافظه یا اعلان را فعال نمی‌کند.')}</span></p>
        {value.mode === 'off' && <p className="vx-section-foot">{t('Relationship features are currently unavailable. Review the settings in You for prerequisites.', 'ویژگی‌های ارتباطی اکنون در دسترس نیستند. پیش‌نیازها را در تنظیمات بخش «شما» ببینید.')}</p>}
      </div>}
      {part !== 'checkins' && <Section foot={blocked ? pauseReason : undefined}>
        <Switch checked={value.externalEnabled} disabled={busy || (blocked || !value.externalAvailable) && !value.externalEnabled}
          label={t('Generic Telegram alerts', 'اعلان عمومی تلگرام')} sub={<>{t('Alerts say that a check-in is ready. They never include conversation content.', 'اعلان فقط می‌گوید بررسی آماده است و هرگز محتوای گفتگو را شامل نمی‌شود.')}
            {allAgentsNote && part !== 'alerts' && <> {t(`This applies to every agent in your ${space} space, not only ${name}.`, `این برای همهٔ عامل‌های فضای ${space === 'work' ? 'کاری' : 'شخصی'} شماست، نه فقط ${name}.`)}</>}</>}
          onChange={enabled => void update({ action: 'external', enabled })} />
      </Section>}
      {part !== 'alerts' && <>
      <Section title={t('Communication preferences', 'ترجیح‌های ارتباطی')}>
        {value.preferences.length ? value.preferences.map((p, i) => <Row key={`${p.key}-${i}`} plain title={<span dir="auto">{p.value}</span>} />)
          : <Row plain title={<span className="vx-2">{t('No preferences saved.', 'ترجیحی ذخیره نشده است.')}</span>} />}
      </Section>
      <Section title={t('Private check-ins', 'بررسی‌های خصوصی')}>
        {blocked ? <Row plain title={<span className="vx-2">{pauseReason}</span>} />
          : !identityConfirmed ? <Row plain title={<span className="vx-2">{t('Private check-ins are hidden until identity is confirmed.', 'بررسی‌های خصوصی تا زمان تأیید هویت پنهان هستند.')}</span>} />
          : !value.inbox.length ? <Row plain title={<span className="vx-2">{t('No check-ins right now.', 'اکنون بررسی‌ای وجود ندارد.')}</span>} />
          : value.inbox.map(item => <div key={item.id} className="vx-row top vx-rel-item">
            {item.status === 'unread' ? <span className="vx-rel-dot" aria-label={t('Unread', 'خوانده‌نشده')} /> : <span className="vx-rel-dot read" aria-hidden="true" />}
            <span className="vx-row-main"><span className="vx-row-title plain" dir="auto">{item.text}</span>
              <span className="vx-rel-actions">
                {item.status === 'unread' && <button type="button" className="vx-btn vx-btn-secondary vx-btn-xs" disabled={busy} onClick={() => void update({ action: 'read', itemId: item.id })}>{t('Mark read', 'علامت‌گذاری به‌عنوان خوانده‌شده')}</button>}
                <button type="button" className="vx-btn vx-btn-ghost vx-btn-xs" disabled={busy} onClick={() => void update({ action: 'dismiss', itemId: item.id })}>{t('Dismiss', 'بستن')}</button>
              </span></span>
          </div>)}
      </Section>
      {!!value.sources.length && <Section title={t('Sources used for this relationship', 'منابع این ارتباط')}>
        {value.sources.map(source => <Row key={source.id} plain title={new Date(source.createdAt).toLocaleDateString(fa ? 'fa-IR' : 'en', { day: 'numeric', month: 'short', year: 'numeric' })}
          end={<button type="button" className="vx-btn vx-btn-secondary vx-btn-xs" disabled={busy} onClick={() => void update({ action: 'source-delete', sourceId: source.id })}>{t('Remove source', 'حذف منبع')}</button>} />)}
      </Section>}
      {!confirmForget
        ? <div className="vx-group"><Row tone="danger" lead={<Icon name="trash" size={20} />} title={t('Forget relationship context', 'فراموش کردن زمینهٔ ارتباط')} disabled={busy || !allowManage} onClick={() => { haptic.warn(); setConfirmForget(true); }} /></div>
        : <div className="vx-you-confirm" role="group" aria-label={t('Forget relationship confirmation', 'تأیید فراموشی زمینه')}>
          <p className="vx-head">{t('Clear open situations and pending check-ins?', 'موقعیت‌های باز و بررسی‌های در انتظار پاک شوند؟')}</p>
          <div className="vx-dock-row">
            <button type="button" className="vx-btn vx-btn-secondary" disabled={busy} onClick={() => setConfirmForget(false)}>{t('Keep it', 'نگه‌داشتن')}</button>
            <button type="button" className="vx-btn vx-btn-danger" disabled={busy} onClick={() => void update({ action: 'forget' })}>{t('Clear context', 'پاک کردن زمینه')}</button>
          </div>
        </div>}
      </>}
    </>}
  </section>;
  if (presentation === 'inline') return body;
  return <>
    <div className="vx-group">
      <Row lead={<span className="vx-tile icon" aria-hidden="true"><Icon name="bell" size={20} /></span>} title={t('Staying in touch', 'در ارتباط ماندن')} plain
        value={summary} chevron onClick={() => { haptic.light(); setOpen(true); }} />
    </div>
    <LiveSheet open={open} scope={scope} onClose={() => { if (!busy) setOpen(false); }} label={t('Staying in touch', 'در ارتباط ماندن')}>{body}</LiveSheet>
  </>;
}
