'use client';
/* eslint-disable @next/next/no-html-link-for-pages -- Privacy entry/exit must reload the document to discard SDK/replay state. */
import { useEffect, useRef, useState } from 'react';
import { guestRightsCopy } from '@/lib/adaptive/guest-rights/notice';
import type { GuestCreate } from '@/lib/adaptive/guest-rights/contracts';
import { guestRightsApi, GuestClientError, type GuestNotice, type GuestDraft, type GuestCurrent } from '../../studio/_lib/guest-rights-client';
export function GuestRightsPanel() {
    const [locale, setLocale] = useState<'en' | 'fa'>('en'), [notice, setNotice] = useState<GuestNotice>(), [draft, setDraft] = useState<GuestDraft>(), [reference, setReference] = useState(''), [credential, setCredential] = useState(''), [showCode, setShowCode] = useState(false), [saved, setSaved] = useState(false), [kind, setKind] = useState<GuestCreate['kind']>('access_export'), [context, setContext] = useState<GuestCreate['context']>('unknown'), [current, setCurrent] = useState<GuestCurrent>(), [busy, setBusy] = useState(false), [message, setMessage] = useState<'unknown' | 'error' | 'missing' | null>(null), [closing, setClosing] = useState(false);
    const [hydrated, setHydrated] = useState(false);
    const generation = useRef(0), controllers = useRef(new Set<AbortController>()), eventId = useRef<string | undefined>(undefined);
    const c = guestRightsCopy[locale];
    useEffect(() => { setHydrated(true); const pending = controllers.current, epoch = generation; const controller = new AbortController(); controllers.current.add(controller); void guestRightsApi.notice(controller.signal).then(value => { if (controller.signal.aborted) return; setNotice(value); if(value.available) setKind(selected => value.supportedKinds.includes(selected) ? selected : value.supportedKinds[0]); }).catch(() => setNotice({ available: false, supportedKinds: [], supportContact: 'info@joyixir.com' })); return () => { epoch.current++; for (const c of pending)
        c.abort(); pending.clear(); }; }, []);
    async function run(action: 'draft' | 'create' | 'status' | 'close') {
        if (!hydrated || busy)
            return;
        const active = ++generation.current, controller = new AbortController();
        controllers.current.add(controller);
        setBusy(true);
        setMessage(null);
        try {
            if (action === 'draft') {
                const result = await guestRightsApi.draft(controller.signal);
                if (active !== generation.current)
                    return;
                setDraft(result);
                setReference(result.requestId);
                setCredential(result.credential);
                setSaved(false);
                setCurrent(undefined);
                eventId.current = crypto.randomUUID();
            }
            else {
                const input = { version: 1 as const, requestId: reference, credential };
                let result: GuestCurrent;
                if (action === 'create') {
                    if (!draft || !saved || !eventId.current)
                        return;
                    result = await guestRightsApi.create({ ...input, ticket: draft.ticket, eventId: eventId.current, kind, context, locale, expectedPolicyRevision: draft.policyRevision }, controller.signal);
                }
                else if (action === 'close') {
                    if (!current || 'expired' in current)
                        return;
                    result = await guestRightsApi.close({ ...input, eventId: crypto.randomUUID(), expectedRevision: current.request.revision }, controller.signal);
                }
                else
                    result = await guestRightsApi.status(input, controller.signal);
                if (active !== generation.current)
                    return;
                setCurrent(result);
                setClosing(false);
                if (action === 'create')
                    setDraft(undefined);
            }
        }
        catch (error) {
            if (active !== generation.current)
                return;
            if (action === 'status' && error instanceof GuestClientError && error.status === 404) {
                setCurrent(undefined);
                setMessage('missing');
            }
            else
                setMessage((action === 'create' || action === 'close') && !(error instanceof GuestClientError && error.status >= 400 && error.status < 500) ? 'unknown' : 'error');
        }
        finally {
            controllers.current.delete(controller);
            if (active === generation.current)
                setBusy(false);
        }
    }
    const change = () => { setDraft(undefined); setCurrent(undefined); setSaved(false); setMessage(null); setClosing(false); };
    const blocked = !hydrated || busy || message === 'unknown';
    return <section className="guest-rights sentry-block" data-guest-rights-private="true" dir={locale === 'fa' ? 'rtl' : 'ltr'} lang={locale}>
    <label>{c.language}<select value={locale} disabled={!hydrated || busy} onChange={e => setLocale(e.target.value as 'en' | 'fa')}><option value="en">English</option><option value="fa">فارسی</option></select></label>
    <a href="/">Vox</a><p><bdi>Joyixir OÜ</bdi></p><h1>{c.title}</h1><p>{c.intro}</p><p>{c.scope}</p><p>{c.effect}</p><p>{c.coverage}</p>
    {!notice?.available && <p role="status">{c.unavailable}</p>}
    <p>{c.contact}: <a href="mailto:info@joyixir.com" dir="ltr">info@joyixir.com</a></p>
    {notice?.available && <><label>{c.kind}<select value={kind} disabled={blocked || !!current} onChange={e => setKind(e.target.value as GuestCreate['kind'])}>{notice.supportedKinds.map(k => <option key={k} value={k}>{c.kinds[k]}</option>)}</select></label><label>{c.context}<select value={context} disabled={blocked || !!current} onChange={e => setContext(e.target.value as GuestCreate['context'])}>{(['unknown', 'work', 'personal'] as const).map(k => <option key={k} value={k}>{c[k]}</option>)}</select></label><button disabled={blocked} onClick={() => void run('draft')}>{c.prepare}</button></>}
    <label>{c.reference}<input value={reference} dir="ltr" autoComplete="off" maxLength={36} disabled={!hydrated || busy} onChange={e => { change(); setReference(e.target.value); }}/></label>
    <label>{c.credential}<input type={showCode ? 'text' : 'password'} value={credential} dir="ltr" autoComplete="off" data-lpignore="true" data-1p-ignore="true" maxLength={43} disabled={!hydrated || busy} onChange={e => { change(); setCredential(e.target.value); }}/></label>
    <button disabled={!hydrated || busy} onClick={() => setShowCode(v => !v)}>{showCode ? c.hide : c.reveal}</button>
    {draft && <><p>{c.preserve}</p><label className="guest-check"><input type="checkbox" checked={saved} disabled={blocked} onChange={e => setSaved(e.target.checked)}/>{c.saved}</label><button disabled={blocked || !saved || !notice?.available} onClick={() => void run('create')}>{c.submit}</button></>}
    <button disabled={!hydrated || busy || reference.length !== 36 || credential.length !== 43} onClick={() => void run('status')}>{c.status}</button>
    {busy && <p role="status">{c.pending}</p>}{message && <p role="alert">{message === 'unknown' ? c.unknownOutcome : c[message]}</p>}
    {current && ('expired' in current ? <p role="status">{c.expired} <bdi>{new Date(current.retainUntil).toLocaleString(locale)}</bdi></p> : <article aria-label={c.reference}><h2><bdi>{current.request.requestId}</bdi></h2><p>{c.states[current.request.state]}</p><p>{c.received}: <bdi>{new Date(current.request.createdAt).toLocaleString(locale)}</bdi></p><p>{c.updated}: <bdi>{new Date(current.request.updatedAt).toLocaleString(locale)}</bdi></p>{current.request.retentionReviewRequired && <p>{c.review}</p>}{current.request.state !== 'closed_unfulfilled' && <>{!closing ? <button disabled={blocked} onClick={() => setClosing(true)}>{c.close}</button> : <div><p>{c.confirmClose}</p><button disabled={blocked} onClick={() => void run('close')}>{c.confirm}</button><button disabled={!hydrated || busy} onClick={() => setClosing(false)}>{c.cancel}</button></div>}</>}</article>)}
  </section>;
}
