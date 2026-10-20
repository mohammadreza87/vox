'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { useProductPause, type PauseSpace } from '../_lib/product-pause-client';
import { pauseText } from '../_lib/product-pause-copy';

/** Deliberately independent of the optional-profile and note-correction channel. */
export function ProductPausePanel({ locale = 'en', sessionKey, onReviewProfile }: {
  locale?: 'en' | 'fa'; sessionKey?: string; onReviewProfile?: () => void;
}) {
  const [space, setSpace] = useState<PauseSpace>('work');
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
  const actionStyle = { minHeight: 44, whiteSpace: 'normal' as const, overflowWrap: 'anywhere' as const };
  return <section className="vx-card vx-privacy-card" dir={locale === 'fa' ? 'rtl' : 'ltr'} lang={locale}
    aria-labelledby={`${id}-title`} aria-busy={working} style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
    <div role="group" aria-label={locale === 'fa' ? 'فضای کنترل مکث' : 'Pause control space'} className="vx-privacy-actions" style={{ flexWrap: 'wrap' }}>
      {(['work', 'personal'] as const).map(value => <button className="vx-btn vx-btn-secondary" key={value} style={actionStyle} aria-pressed={space === value}
        onClick={() => { setConfirming(false); setSpace(value); }}>{locale === 'fa' ? value === 'work' ? 'کاری' : 'شخصی' : value === 'work' ? 'Work' : 'Personal'}</button>)}
    </div>
    <h2 id={`${id}-title`} className="vx-head">{copy('title')}</h2>
    <p className="vx-small">{copy('scope')}</p>
    <p className="vx-small">{copy('explanation')}</p>
    <p className="vx-small">{copy('continues')}</p>
    <p className="vx-small vx-2">{copy('otherSettings')}</p>
    <p className="vx-small vx-2">{copy('retention')}</p>
    <details><summary>{locale === 'fa' ? 'محدودیت تحویل' : 'Delivery limit'}</summary><p className="vx-small">{copy('recall')}</p></details>
    {working && <p role="status" aria-live="polite">{control.phase === 'pending' ? copy(control.command?.action === 'resume' ? 'pendingResume' : 'pendingPause') : copy('loading')}</p>}
    <p ref={status} tabIndex={-1} role={control.phase === 'unknown' || control.phase === 'auth' ? 'alert' : 'status'} aria-live="polite">
      {control.phase === 'auth' ? copy('auth') : current && control.status?.productPaused !== null ? copy(paused ? 'paused' : 'unpaused') : <>
        {control.phase === 'unknown' && copy('unknownStatus')}
        {control.status?.productPaused !== null && control.status?.productPaused !== undefined && <span>{copy('lastConfirmed')} {copy(paused ? 'paused' : 'unpaused')}</span>}
      </>}
    </p>
    {control.notice && <p role={['unknown', 'stale'].includes(control.notice) ? 'alert' : 'status'}>{copy(noticeKey[control.notice])}</p>}
    {unavailable && <p role="status">{copy(current && paused ? 'unavailablePaused' : current && unprepared ? 'unsupported' : 'unverified')}</p>}
    <div className="vx-privacy-actions" style={{ flexWrap: 'wrap' }}>
      {current && control.status?.available && !paused && <button className="vx-btn vx-btn-secondary" style={actionStyle} disabled={!control.status.canPause}
        onClick={() => { void control.act('pause'); }}>{copy('pause')}</button>}
      {current && control.status?.available && paused && !confirming && <button ref={reviewButton} className="vx-btn vx-btn-secondary" style={actionStyle}
        onClick={() => setConfirming(true)}>{copy('reviewResume')}</button>}
      {control.phase !== 'pending' && <button className="vx-btn vx-btn-secondary" style={actionStyle} disabled={working} onClick={() => { setConfirming(false); void control.refresh(); }}>{copy('check')}</button>}
    </div>
    {confirming && current && paused && <div aria-labelledby={`${id}-resume`}>
      <h3 ref={confirmHeading} id={`${id}-resume`} tabIndex={-1} className="vx-head">{copy('resumeTitle')}</h3><p className="vx-small">{copy('resumeBody')}</p>
      {!control.status?.canResume && <p id={`${id}-resume-reason`} className="vx-small">{control.status?.resumeReason === 'profile_confirmation_required'
        ? locale === 'fa' ? 'پیش از این اقدام، نمایهٔ فعلی خود را تأیید کنید. مکث شما برقرار می‌ماند.' : 'Confirm your current profile before this action. Your pause remains in place.'
        : control.status?.resumeReason === 'storage_unavailable' ? locale === 'fa' ? 'تنظیمات ذخیره‌شدهٔ فعلی قابل تأیید نیست. وضعیت فعلی را بررسی کنید.' : 'Current saved settings could not be verified. Check current status.'
          : locale === 'fa' ? 'این اقدام اکنون در دسترس نیست.' : 'This action is currently unavailable.'}</p>}
      {!control.status?.canResume && control.status?.resumeReason === 'profile_confirmation_required' && onReviewProfile && <button className="vx-btn vx-btn-secondary" style={actionStyle} onClick={onReviewProfile}>{locale === 'fa' ? 'بررسی نمایهٔ فعلی' : 'Review current profile'}</button>}
      <div className="vx-privacy-actions" style={{ flexWrap: 'wrap' }}><button className="vx-btn vx-btn-secondary" style={actionStyle} disabled={!control.status?.canResume}
        aria-describedby={`${id}-resume-reason`} onClick={() => { setConfirming(false); void control.act('resume'); }}>{copy('resume')}</button>
      <button className="vx-btn vx-btn-secondary" style={actionStyle} onClick={() => { setConfirming(false); requestAnimationFrame(() => reviewButton.current?.focus()); }}>{copy('keepPaused')}</button></div>
    </div>}
  </section>;
}
