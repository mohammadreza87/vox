'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { useProductPause, type PauseSpace } from '../_lib/product-pause-client';
import { pauseText } from '../_lib/product-pause-copy';
import { haptic } from '../_lib/haptics';
import { Banner, Seg, Spinner } from './ui';

/** Deliberately independent of the optional-profile and note-correction channel. */
export function ProductPausePanel({ locale = 'en', sessionKey, onReviewProfile, initialSpace = 'work' }: {
  locale?: 'en' | 'fa'; sessionKey?: string; onReviewProfile?: () => void;
  /** Opens on this space; the panel keeps its own space choice so pause never waits on the app's locks. */
  initialSpace?: PauseSpace;
}) {
  const [space, setSpace] = useState<PauseSpace>(initialSpace);
  const control = useProductPause(space, sessionKey);
  const [confirming, setConfirming] = useState(false);
  const id = useId(), confirmHeading = useRef<HTMLHeadingElement>(null), reviewButton = useRef<HTMLButtonElement>(null), status = useRef<HTMLParagraphElement>(null);
  const copy = (key: Parameters<typeof pauseText>[2]) => pauseText(locale, space, key);
  const current = control.phase === 'ready';
  const paused = control.status?.productPaused === true;
  const working = ['initial', 'loading', 'pending'].includes(control.phase);
  useEffect(() => { setConfirming(false); }, [space, sessionKey, control.status?.accountId, control.status?.useEpoch]);
  useEffect(() => { if (confirming) confirmHeading.current?.focus(); }, [confirming]);
  useEffect(() => { if (control.notice === 'stale') { setConfirming(false); status.current?.focus(); } }, [control.notice]);
  const unavailable = control.status && !control.status.available;
  const reason = control.status?.reason;
  const unprepared = reason === 'store_not_prepared';
  const noticeKey = { unknown: 'unknownOutcome', stale: 'stale', current: 'current', pause: 'pauseSuccess', resume: 'resumeSuccess', unchanged: 'unchanged' } as const;
  const fa = locale === 'fa';
  const tone = !current || control.status?.productPaused == null ? 'var(--text-3)' : paused ? 'var(--warn)' : 'var(--success)';
  return <section className="vx-pause" dir={fa ? 'rtl' : 'ltr'} lang={locale}
    aria-labelledby={`${id}-title`} aria-busy={working}>
    <Seg label={fa ? 'فضای کنترل مکث' : 'Pause control space'} value={space} onChange={value => { setConfirming(false); setSpace(value); }}
      options={[{ value: 'work', label: fa ? 'کاری' : 'Work' }, { value: 'personal', label: fa ? 'شخصی' : 'Personal' }]} />
    <div className="vx-sheet-head">
      <h2 id={`${id}-title`} className="vx-title-m">{copy('title')}</h2>
      <p className="vx-small vx-2">{copy('scope')}</p>
    </div>
    <div className="vx-pause-state" style={{ '--status': tone } as React.CSSProperties}>
      <span className="vx-status-dot" aria-hidden="true" />
      <p ref={status} tabIndex={-1} role={control.phase === 'unknown' || control.phase === 'auth' ? 'alert' : 'status'} aria-live="polite">
        {control.phase === 'auth' ? copy('auth') : current && control.status?.productPaused !== null ? copy(paused ? 'paused' : 'unpaused') : <>
          {control.phase === 'unknown' && copy('unknownStatus')}
          {control.status?.productPaused !== null && control.status?.productPaused !== undefined && <span>{copy('lastConfirmed')} {copy(paused ? 'paused' : 'unpaused')}</span>}
        </>}
      </p>
    </div>
    {working && <p className="vx-pause-note" role="status" aria-live="polite"><Spinner size={14} /> {control.phase === 'pending' ? copy(control.command?.action === 'resume' ? 'pendingResume' : 'pendingPause') : copy('loading')}</p>}
    {control.notice && <Banner tone={['unknown', 'stale'].includes(control.notice) ? 'warn' : 'info'} icon={['unknown', 'stale'].includes(control.notice) ? 'warn' : 'check'}>
      <span role={['unknown', 'stale'].includes(control.notice) ? 'alert' : 'status'}>{copy(noticeKey[control.notice])}</span></Banner>}
    {unavailable && <p className="vx-pause-note" role="status">{copy(current && paused ? 'unavailablePaused' : current && unprepared ? 'unsupported' : 'unverified')}</p>}
    <div className="vx-pause-prose">
      <p>{copy('explanation')}</p>
      <p>{copy('continues')}</p>
      <p className="vx-2">{copy('otherSettings')}</p>
      <p className="vx-2">{copy('retention')}</p>
    </div>
    <details className="vx-disclosure"><summary>{fa ? 'محدودیت تحویل' : 'Delivery limit'}</summary><p className="vx-small vx-2">{copy('recall')}</p></details>
    {confirming && current && paused && <div className="vx-pause-confirm" aria-labelledby={`${id}-resume`}>
      <h3 ref={confirmHeading} id={`${id}-resume`} tabIndex={-1} className="vx-head">{copy('resumeTitle')}</h3><p className="vx-small vx-2">{copy('resumeBody')}</p>
      {!control.status?.canResume && <p id={`${id}-resume-reason`} className="vx-small">{control.status?.resumeReason === 'profile_confirmation_required'
        ? fa ? 'پیش از این اقدام، نمایهٔ فعلی خود را تأیید کنید. مکث شما برقرار می‌ماند.' : 'Confirm your current profile before this action. Your pause remains in place.'
        : control.status?.resumeReason === 'storage_unavailable' ? fa ? 'تنظیمات ذخیره‌شدهٔ فعلی قابل تأیید نیست. وضعیت فعلی را بررسی کنید.' : 'Current saved settings could not be verified. Check current status.'
          : fa ? 'این اقدام اکنون در دسترس نیست.' : 'This action is currently unavailable.'}</p>}
      {!control.status?.canResume && control.status?.resumeReason === 'profile_confirmation_required' && onReviewProfile && <button className="vx-btn vx-btn-ghost vx-btn-sm" onClick={onReviewProfile}>{fa ? 'بررسی نمایهٔ فعلی' : 'Review current profile'}</button>}
      <div className="vx-dock-row">
        <button className="vx-btn vx-btn-secondary" onClick={() => { setConfirming(false); requestAnimationFrame(() => reviewButton.current?.focus()); }}>{copy('keepPaused')}</button>
        <button className="vx-btn vx-btn-primary" disabled={!control.status?.canResume}
          aria-describedby={`${id}-resume-reason`} onClick={() => { haptic.tap(); setConfirming(false); void control.act('resume'); }}>{copy('resume')}</button>
      </div>
    </div>}
    <div className="vx-pause-actions">
      {current && control.status?.available && !paused && <button className="vx-btn vx-btn-primary vx-btn-block" disabled={!control.status.canPause}
        onClick={() => { haptic.tap(); void control.act('pause'); }}>{copy('pause')}</button>}
      {current && control.status?.available && paused && !confirming && <button ref={reviewButton} className="vx-btn vx-btn-secondary vx-btn-block"
        onClick={() => { haptic.warn(); setConfirming(true); }}>{copy('reviewResume')}</button>}
      {control.phase !== 'pending' && <button className="vx-btn vx-btn-ghost vx-btn-sm" disabled={working} onClick={() => { setConfirming(false); void control.refresh(); }}>{copy('check')}</button>}
    </div>
  </section>;
}
