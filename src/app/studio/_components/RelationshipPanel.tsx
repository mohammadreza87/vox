'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useProductPause } from '../_lib/product-pause-client';
import { pauseText } from '../_lib/product-pause-copy';
import { api, tg, type RelationshipSpace, type RelationshipView } from '../_lib/client';

type UseBoundary = Readonly<{ scope: string; accountId?: string; useEpoch: number | null | undefined; blocked: boolean; phase: string | undefined }>;
type Props = { agentId: string; name: string; space?: RelationshipSpace; locale?: 'en' | 'fa'; identityConfirmed?: boolean };
export function RelationshipPanel({ agentId, name, space = 'work', locale = 'en', identityConfirmed = false }: Props) {
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
  return <section className="vx-card" dir={fa ? 'rtl' : 'ltr'} lang={fa ? 'fa' : 'en'} aria-labelledby="relationship-title" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
    <div><h2 id="relationship-title" className="vx-title-m" style={{ margin: 0 }}>{t('Staying in touch', 'در ارتباط ماندن')}</h2>
      <p className="vx-small vx-2" style={{ margin: '5px 0 0' }}>{t(`Manage ${name}’s follow-ups and private check-ins in your ${space} space.`, `پیگیری‌ها و بررسی‌های خصوصی ${name} را در فضای ${space === 'work' ? 'کاری' : 'شخصی'} مدیریت کنید.`)}</p></div>
    <button className="vx-btn vx-btn-secondary vx-btn-sm" disabled={busy || loading} onClick={() => void load()}>{t('Refresh relationship settings', 'تازه‌سازی تنظیمات ارتباط')}</button>
    {!value && !error && <p className="vx-small vx-2" role="status">{t('Loading relationship settings…', 'در حال دریافت تنظیمات ارتباط…')}</p>}
    {error && <div className="vx-banner danger" role="alert">{error}</div>}
    {value && <>
      <p className="vx-small" style={{ margin: 0 }} role="status">{!available ? t('Follow-ups are unavailable in this space. You can still pause, stop, or clear existing context.', 'پیگیری در این فضا در دسترس نیست. همچنان می‌توانید آن را متوقف یا مکث کنید یا زمینهٔ موجود را پاک کنید.') : paused ? t('Follow-ups are paused.', 'پیگیری‌ها مکث شده‌اند.') : stopped ? t('Follow-ups are stopped.', 'پیگیری‌ها متوقف شده‌اند.') : t('Follow-ups are available for useful open conversations.', 'پیگیری برای گفتگوهای باز و مفید در دسترس است.')}</p>
      {value.mode === 'off' && <p className="vx-small vx-2">{t('Relationship features are currently unavailable. Review Privacy and memory settings for prerequisites.', 'ویژگی‌های ارتباطی اکنون در دسترس نیستند. پیش‌نیازها را در تنظیمات حریم خصوصی و حافظه ببینید.')}</p>}
      <div className="vx-group" style={{ padding: 12 }}><div className="vx-small" style={{ fontWeight: 600, marginBottom: 6 }}>{t('Communication preferences', 'ترجیح‌های ارتباطی')}</div>
        {value.preferences.length ? <ul style={{ margin: 0, paddingInlineStart: 20 }}>{value.preferences.map((p, i) => <li key={`${p.key}-${i}`} className="vx-small">{p.value}</li>)}</ul> : <p className="vx-small vx-2" style={{ margin: 0 }}>{t('No preferences saved.', 'ترجیحی ذخیره نشده است.')}</p>}</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {paused || stopped ? <button className="vx-btn vx-btn-primary vx-btn-sm" disabled={busy || !available || blocked} onClick={() => void update({ action: 'resume' })}>{t('Resume follow-ups', 'ازسرگیری پیگیری')}</button> : null}
        <button className="vx-btn vx-btn-secondary vx-btn-sm" disabled={busy} onClick={() => void update({ action: 'pause', until: new Date(Date.now() + 7 * 86_400_000).toISOString() })}>{t('Pause for 7 days', 'مکث برای ۷ روز')}</button>
        <button className="vx-btn vx-btn-secondary vx-btn-sm" disabled={busy || !allowManage} onClick={() => void update({ action: 'stop' })}>{t('Stop follow-ups', 'توقف پیگیری')}</button>
      </div>
      <p className="vx-small vx-2" style={{ margin: '-8px 0 0' }}>{t('Resuming does not grant memory or notification permissions.', 'ازسرگیری، مجوز حافظه یا اعلان را فعال نمی‌کند.')}</p>
      <label className="vx-privacy-checkbox"><input type="checkbox" checked={value.externalEnabled} disabled={busy || (blocked || !value.externalAvailable) && !value.externalEnabled} onChange={e => void update({ action: 'external', enabled: e.target.checked })} />{t('Generic Telegram alerts', 'اعلان عمومی تلگرام')}</label>
      <p className="vx-small vx-2" style={{ margin: '-8px 0 0' }}>{t('Alerts say that a check-in is ready. They never include conversation content.', 'اعلان فقط می‌گوید بررسی آماده است و هرگز محتوای گفتگو را شامل نمی‌شود.')}</p>
      {blocked && <p className="vx-small" role="status">{pauseText(locale, space, pause.status?.productPaused ? 'pausedUse' : 'unverified')}</p>}
      {!identityConfirmed && <p className="vx-small vx-2">{t('Confirm your identity in Privacy and memory settings to view private check-ins.', 'برای دیدن بررسی‌های خصوصی، هویت خود را در تنظیمات حریم خصوصی و حافظه تأیید کنید.')}</p>}
      <div><h3 className="vx-small" style={{ fontWeight: 600 }}>{t('Private check-ins', 'بررسی‌های خصوصی')}</h3>
        {blocked ? <p className="vx-small vx-2">{pauseText(locale, space, pause.status?.productPaused ? 'pausedUse' : 'unverified')}</p> : !identityConfirmed ? <p className="vx-small vx-2">{t('Private check-ins are hidden until identity is confirmed.', 'بررسی‌های خصوصی تا زمان تأیید هویت پنهان هستند.')}</p> : !value.inbox.length ? <p className="vx-small vx-2">{t('No check-ins right now.', 'اکنون بررسی‌ای وجود ندارد.')}</p> : value.inbox.map(item => <article className="vx-group" key={item.id} style={{ padding: 12, marginBottom: 8 }}><p className="vx-small" style={{ marginTop: 0 }}>{item.text}</p><div style={{ display: 'flex', gap: 8 }}>{item.status === 'unread' && <button className="vx-btn vx-btn-secondary vx-btn-sm" disabled={busy} onClick={() => void update({ action: 'read', itemId: item.id })}>{t('Mark read', 'علامت‌گذاری به‌عنوان خوانده‌شده')}</button>}<button className="vx-btn vx-btn-secondary vx-btn-sm" disabled={busy} onClick={() => void update({ action: 'dismiss', itemId: item.id })}>{t('Dismiss', 'بستن')}</button></div></article>)}</div>
      {!!value.sources.length && <div><h3 className="vx-small" style={{ fontWeight: 600 }}>{t('Sources used for this relationship', 'منابع این ارتباط')}</h3>{value.sources.map(source => <div key={source.id} className="vx-group" style={{ padding: 8, marginBottom: 6 }}><span className="vx-small">{new Date(source.createdAt).toLocaleDateString(fa ? 'fa-IR' : 'en')}</span><button className="vx-btn vx-btn-secondary vx-btn-sm" disabled={busy} onClick={() => void update({ action: 'source-delete', sourceId: source.id })}>{t('Remove source', 'حذف منبع')}</button></div>)}</div>}
      {!confirmForget ? <button className="vx-btn vx-btn-secondary vx-btn-sm" disabled={busy || !allowManage} onClick={() => setConfirmForget(true)}>{t('Forget relationship context', 'فراموش کردن زمینهٔ ارتباط')}</button> : <div role="group" aria-label={t('Forget relationship confirmation', 'تأیید فراموشی زمینه')} style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}><span className="vx-small">{t('Clear open situations and pending check-ins?', 'موقعیت‌های باز و بررسی‌های در انتظار پاک شوند؟')}</span><button className="vx-btn vx-btn-danger vx-btn-sm" disabled={busy} onClick={() => void update({ action: 'forget' })}>{t('Clear context', 'پاک کردن زمینه')}</button><button className="vx-btn vx-btn-secondary vx-btn-sm" disabled={busy} onClick={() => setConfirmForget(false)}>{t('Keep it', 'نگه‌داشتن')}</button></div>}
    </>}
  </section>;
}
