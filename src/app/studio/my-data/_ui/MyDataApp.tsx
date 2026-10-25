'use client';

/**
 * My data (VoxxBot's Mini App): the person's own pet care, choices, group participation and notes, each note erasable,
 * the whole export as JSON, and "Forget everything" behind a confirm. Every call carries the initData this page was
 * opened with; if Telegram's session changes (another account) the page stops and asks to be reopened.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MY_DATA_API, type MyDataForgetResponse, type MyDataResponse } from '@/lib/studio/my-data-contract';
import { myDataCopy, myDataLang, type MyDataLang } from './copy';

interface Bridge {
  initData?: string;
  initDataUnsafe?: { user?: { language_code?: string } };
  ready?(): void;
  expand?(): void;
  showConfirm?(message: string, cb: (ok: boolean) => void): void;
}
const bridge = (): Bridge | null => (typeof window === 'undefined' ? null
  : (window as unknown as { Telegram?: { WebApp?: Bridge } }).Telegram?.WebApp ?? null);

class Refused extends Error { constructor(readonly status: number) { super(`my-data ${status}`); } }

function confirmNative(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    const app = bridge();
    if (app?.showConfirm) { try { app.showConfirm(message, (ok) => resolve(!!ok)); return; } catch { /* unsupported */ } }
    try { resolve(typeof window.confirm === 'function' ? window.confirm(message) : false); } catch { resolve(false); }
  });
}

export function MyDataApp() {
  // Telegram exists only on the client: the first render matches the server's markup (English, no data).
  const [signed, setSigned] = useState<string | null>(null);
  const [lang, setLang] = useState<MyDataLang>('en');
  useEffect(() => {
    const app = bridge();
    try { app?.ready?.(); app?.expand?.(); } catch { /* old client */ }
    setLang(myDataLang(app?.initDataUnsafe?.user?.language_code));
    setSigned(app?.initData ?? '');
  }, []);
  const t = myDataCopy(lang);
  return (
    <main className="vxd-root" lang={lang} dir={lang === 'fa' ? 'rtl' : 'ltr'}>
      <div className="vxd-wrap">
        <h1>{t.title}</h1>
        <p className="vxd-muted">{t.intro}</p>
        {signed === null ? <p role="status">{t.loading}</p>
          : signed ? <MyDataSession signed={signed} lang={lang} /> : <p role="alert" className="vxd-alert">{t.reopen}</p>}
      </div>
    </main>
  );
}

function MyDataSession({ signed, lang }: { signed: string; lang: MyDataLang }) {
  const t = myDataCopy(lang);
  const [data, setData] = useState<MyDataResponse | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed' | 'reopen'>('loading');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState('');
  const [copied, setCopied] = useState(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const call = useCallback(async <T,>(method: 'GET' | 'POST' | 'DELETE', path = '', body?: unknown): Promise<T> => {
    if (bridge()?.initData !== signed) throw new Refused(401);
    const res = await fetch(`${MY_DATA_API}${path}`, {
      method, cache: 'no-store', credentials: 'same-origin',
      headers: { 'X-Telegram-Init-Data': signed, Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (bridge()?.initData !== signed) throw new Refused(401);
    if (!res.ok) throw new Refused(res.status);
    return await res.json() as T;
  }, [signed]);

  const fail = useCallback((e: unknown) => {
    if (!alive.current) return;
    setStatus(e instanceof Refused && e.status === 401 ? 'reopen' : 'failed');
  }, []);
  const load = useCallback(async () => {
    setStatus('loading');
    try { const next = await call<MyDataResponse>('GET'); if (alive.current) { setData(next); setStatus('ready'); } }
    catch (e) { setData(null); fail(e); }
  }, [call, fail]);
  useEffect(() => { void load(); }, [load]);

  const name = (agentId: string) => data?.agentNames[agentId] ?? t.anAgent;
  const json = useMemo(() => (data ? JSON.stringify(data, null, 2) : ''), [data]);

  async function act(run: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setDone('');
    try { await run(); } catch (e) { fail(e); } finally { if (alive.current) setBusy(false); }
  }
  const eraseNote = (copyId: string) => act(async () => {
    if (!await confirmNative(t.eraseAsk)) return;
    await call<{ erased: boolean }>('DELETE', `/notes/${encodeURIComponent(copyId)}`);
    await load();
  });
  const forget = () => act(async () => {
    if (!await confirmNative(t.forgetAsk)) return;
    const result = await call<MyDataForgetResponse>('POST', '/forget', { confirm: true });
    if (alive.current) setDone(t.forgotten(result));
    await load();
  });
  async function copy() {
    try { await navigator.clipboard.writeText(json); setCopied(true); } catch { setCopied(false); }
  }

  if (status === 'reopen') return <p role="alert" className="vxd-alert">{t.reopen}</p>;
  if (status === 'failed' && !data) return <div role="alert" className="vxd-alert">{t.failed} <button type="button" onClick={() => void load()}>{t.retry}</button></div>;
  if (!data) return <p role="status">{t.loading}</p>;
  const notes = data.notes ?? [];
  return (
    <>
      {done && <p role="status" className="vxd-done">{done}</p>}
      {status === 'failed' && <div role="alert" className="vxd-alert">{t.failed}</div>}
      <section className="vxd-card" aria-label={t.pets}>
        <h2>{t.pets}</h2>
        {data.petCare.length ? <ul>{data.petCare.map((c) => <li key={c.agentId}><bdi>{name(c.agentId)}</bdi></li>)}</ul> : <p className="vxd-muted">{t.petsEmpty}</p>}
      </section>
      {!!data.agentChoices?.length && <section className="vxd-card" aria-label={t.choices}>
        <h2>{t.choices}</h2>
        <ul>{data.agentChoices.map((c) => <li key={c.agentId} className="vxd-row"><bdi>{name(c.agentId)}</bdi><span className="vxd-muted">{t.choice[c.choice] ?? c.choice}</span></li>)}</ul>
      </section>}
      {!!data.circles?.length && <section className="vxd-card" aria-label={t.groups}><h2>{t.groups}</h2><p className="vxd-muted">{t.groupCount(data.circles.length)}</p></section>}
      <section className="vxd-card" aria-label={t.notes}>
        <h2>{t.notes}</h2>
        {notes.length ? <ul>{notes.map((n) => (
          <li key={n.copyId} className="vxd-row">
            <div><p className="vxd-note">{n.text}</p>{n.groupTitle && <p className="vxd-muted">{t.fromGroup(n.groupTitle)}</p>}</div>
            <button type="button" disabled={busy} onClick={() => void eraseNote(n.copyId)}>{t.erase}</button>
          </li>))}</ul> : <p className="vxd-muted">{t.notesEmpty}</p>}
      </section>
      <details>
        <summary>{t.json}</summary>
        <button type="button" onClick={() => void copy()}>{copied ? t.copied : t.copy}</button>
        <pre dir="ltr">{json}</pre>
      </details>
      <button type="button" className="vxd-danger" disabled={busy} onClick={() => void forget()}>{t.forget}</button>
    </>
  );
}
