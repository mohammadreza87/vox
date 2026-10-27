'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { MemoryAccountPreview, MemoryAccountStatusResponse } from '@/lib/studio/memory-account';
import type { MyDataLang } from './copy';

const API = '/api/studio/memory-account';
const COPY = {
  en: {
    title: 'Saved memory', scope: 'All your agents · Work and Personal',
    start: 'Set up a fresh conversation', confirm: 'Start fresh', cancel: 'Cancel',
    review: 'Previous memory and permissions will not be restored. This starts a new saved-memory account; it does not erase chats or other saved data.',
    optional: 'Optional memory, archives and connected apps stay separate. This confirmation does not turn them on.',
    confirmed: 'Fresh start confirmed.', pending: 'Conversation setup is separate. This confirmation does not enable replies.',
    existing: 'A saved-memory account already exists. This page does not erase or replace it.',
    erasing: 'Memory controls are pending. A fresh start is not available yet.',
    busy: 'Checking…', expired: 'This confirmation expired. Start again when you are ready.',
    unavailable: 'Memory controls are unavailable right now. Try opening this page again later.',
    reopen: 'Open My data again from Vox to continue.',
    unknown: 'The result could not be confirmed. Check the current status before taking another action.',
    status: 'Check current status',
  },
  fa: {
    title: 'حافظهٔ ذخیره‌شده', scope: 'همهٔ عامل‌های شما · کاری و شخصی',
    start: 'راه‌اندازی گفتگوی تازه', confirm: 'شروع تازه', cancel: 'لغو',
    review: 'حافظه و اجازه‌های قبلی بازیابی نمی‌شوند. یک حساب تازه برای حافظه ساخته می‌شود؛ گفتگوها و دیگر داده‌های ذخیره‌شده پاک نمی‌شوند.',
    optional: 'حافظهٔ اختیاری، بایگانی و برنامه‌های وصل‌شده جدا هستند. این تأیید آن‌ها را فعال نمی‌کند.',
    confirmed: 'شروع تازه تأیید شد.', pending: 'راه‌اندازی گفتگو جداست. این تأیید پاسخ‌گویی را فعال نمی‌کند.',
    existing: 'حساب حافظهٔ ذخیره‌شده از قبل وجود دارد. این صفحه آن را پاک یا جایگزین نمی‌کند.',
    erasing: 'کنترل‌های حافظه در انتظار هستند. شروع تازه هنوز در دسترس نیست.',
    busy: 'در حال بررسی…', expired: 'مهلت این تأیید تمام شد. هر وقت آماده بودید دوباره شروع کنید.',
    unavailable: 'کنترل‌های حافظه اکنون در دسترس نیستند. بعداً دوباره این صفحه را باز کنید.',
    reopen: 'برای ادامه، داده‌های من را دوباره از وکس باز کنید.',
    unknown: 'نتیجه تأیید نشد. پیش از هر اقدام دیگری، وضعیت فعلی را بررسی کنید.',
    status: 'بررسی وضعیت فعلی',
  },
};
type Challenge = { nonce: string; expiresAt: number; preview: MemoryAccountPreview };
type Phase = 'loading' | 'hidden' | 'status' | 'review' | 'expired' | 'unknown' | 'unavailable' | 'reopen';
class RequestFailure extends Error { constructor(readonly status: number) { super('Memory controls request failed'); } }
const currentSession = () => (window as unknown as { Telegram?: { WebApp?: { initData?: string } } }).Telegram?.WebApp?.initData;
function validPreview(value: MemoryAccountPreview): boolean {
  return value?.version === 1 && value.action === 'fresh-bootstrap' && value.scope === 'original-file-canonical-memory-account'
    && value.agents === 'all-canonical-agent-rows' && JSON.stringify(value.spaces) === '["work","personal"]'
    && JSON.stringify(value.expected) === '{"kind":"missing"}' && /^[a-f0-9]{64}(?![\s\S])/.test(value.previewDigest)
    && Object.keys(value).sort().join(',') === 'action,agents,expected,previewDigest,scope,spaces,version';
}

/** Independent protective card: existing My data controls remain usable when this capability is unavailable. */
export function MemoryAccountCard({ signed, lang }: { signed: string; lang: MyDataLang }) {
  const t = COPY[lang];
  const [phase, setPhase] = useState<Phase>('loading');
  const [status, setStatus] = useState<MemoryAccountStatusResponse | null>(null);
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [busy, setBusy] = useState(false);
  const mounted = useRef(false);
  const inFlight = useRef(false);
  const loadVersion = useRef(0);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    const check = () => {
      if (currentSession() === signed) return;
      loadVersion.current += 1; setChallenge(null); setStatus(null); setPhase('reopen');
    };
    const timer = setInterval(check, 1000);
    return () => clearInterval(timer);
  }, [signed]);
  const call = useCallback(async <T,>(path: string, body?: unknown): Promise<T> => {
    if (currentSession() !== signed) throw new RequestFailure(401);
    const response = await fetch(`${API}${path}`, {
      method: body === undefined ? 'GET' : 'POST', cache: 'no-store', credentials: 'same-origin',
      headers: { 'X-Telegram-Init-Data': signed, Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (currentSession() !== signed) throw new RequestFailure(401);
    if (!response.ok) throw new RequestFailure(response.status);
    const value: unknown = await response.json();
    if (currentSession() !== signed) throw new RequestFailure(401);
    return value as T;
  }, [signed]);
  const errorPhase = (error: unknown, fallback: Phase): Phase => error instanceof RequestFailure && error.status === 401 ? 'reopen' : fallback;
  const load = useCallback(async (initial = false) => {
    const version = ++loadVersion.current;
    try {
      const next = await call<MemoryAccountStatusResponse>('');
      if (!mounted.current || version !== loadVersion.current) return;
      if (!['unavailable', 'setup-required', 'legacy-current', 'fresh-confirmed', 'erasing'].includes(next.state) || next.ready !== false) throw new Error('Unsupported memory status');
      setStatus(next); setChallenge(null); setPhase(next.state === 'unavailable' ? initial ? 'hidden' : 'unavailable' : 'status');
    } catch (error) {
      if (!mounted.current || version !== loadVersion.current) return;
      setStatus(null); setChallenge(null);
      setPhase(errorPhase(error, initial ? 'hidden' : 'unavailable'));
    }
  }, [call]);
  useEffect(() => { void load(true); }, [load]);
  useEffect(() => {
    if (phase !== 'review' || !challenge) return;
    const expire = () => { if (Date.now() >= challenge.expiresAt) { setChallenge(null); setPhase('expired'); } };
    expire(); const timer = setInterval(expire, 1000);
    return () => clearInterval(timer);
  }, [phase, challenge]);

  async function act(action: () => Promise<void>, failure: Phase = 'unavailable') {
    if (inFlight.current) return;
    loadVersion.current += 1;
    inFlight.current = true; setBusy(true);
    try { await action(); }
    catch (error) { if (mounted.current) { setChallenge(null); setStatus(null); setPhase(errorPhase(error, failure)); } }
    finally { inFlight.current = false; if (mounted.current) setBusy(false); }
  }
  async function begin() {
    const preview = await call<MemoryAccountPreview>('/preview', {});
    if (!validPreview(preview)) throw new Error('Unsupported preview');
    const next = await call<Challenge>('/challenge', { action: 'fresh-bootstrap', previewDigest: preview.previewDigest });
    if (!/^[a-f0-9]{64}(?![\s\S])/.test(next.nonce) || !Number.isSafeInteger(next.expiresAt) || !validPreview(next.preview) || next.preview.previewDigest !== preview.previewDigest) throw new Error('Unsupported confirmation');
    if (mounted.current) { setChallenge(next); setPhase('review'); }
  }
  async function confirm() {
    if (!challenge || Date.now() >= challenge.expiresAt) { setChallenge(null); setPhase('expired'); return; }
    const submitted = challenge;
    setChallenge(null);
    // Never replay this mutation after a lost response. Only a separate status read can reconcile it.
    const next = await call<{ state: 'fresh-confirmed'; ready: false }>('/confirm', {
      action: 'fresh-bootstrap', previewDigest: submitted.preview.previewDigest, nonce: submitted.nonce,
    });
    if (next.state !== 'fresh-confirmed' || next.ready !== false) throw new Error('Unconfirmed result');
    if (mounted.current) { setStatus({ ...next, reason: 'source-time-and-core-eligibility-not-qualified' }); setPhase('status'); }
  }
  async function cancel() {
    setChallenge(null);
    await call('/cancel', {});
    await load();
  }

  if (phase === 'loading' || phase === 'hidden') return null;
  return <section className="vxd-card" aria-label={t.title} aria-busy={busy}>
    <h2>{t.title}</h2>
    <p className="vxd-muted">{t.scope}</p>
    {phase === 'reopen' ? <p role="alert">{t.reopen}</p>
      : phase === 'unknown' ? <><p role="alert">{t.unknown}</p><button type="button" disabled={busy} onClick={() => void act(() => load())}>{t.status}</button></>
        : phase === 'unavailable' ? <p role="alert">{t.unavailable}</p>
          : phase === 'review' ? <>
            <p>{t.review}</p><p>{t.optional}</p>
            <button type="button" disabled={busy || !challenge} onClick={() => void act(confirm, 'unknown')}>{t.confirm}</button>{' '}
            <button type="button" disabled={busy} onClick={() => void act(cancel)}>{t.cancel}</button>
          </>
            : status?.state === 'fresh-confirmed' ? <><p role="status">{t.confirmed}</p><p>{t.pending}</p></>
              : status?.state === 'legacy-current' ? <p>{t.existing}</p>
                : status?.state === 'erasing' ? <p role="status">{t.erasing}</p>
                  : <>{phase === 'expired' && <p role="status">{t.expired}</p>}<button type="button" disabled={busy} onClick={() => void act(begin)}>{t.start}</button></>}
    {busy && <p role="status">{t.busy}</p>}
  </section>;
}
