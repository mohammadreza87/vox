'use client';

/**
 * The pet over a group (Circles S4, F4): loaded with its CSS only when the page opened with a group code. A halo
 * chip ("2 of 2 here") and two bottom sheets:
 *  - JoinSheet: the group card's own notice and three choices (the server's copy, so the same copyHash). It opens
 *    by itself once, only for someone who never chose here; after any choice it opens only when tapped.
 *  - Notes: the person's own copies as polaroids ("My notes", "From this group"), Erase (own copy only), the first
 *    names of the other joined people (here, never in the group), and Leave group notes.
 * A Join hops with joy (the engine's celebrate, through onJoy) and pops the halo. The quiet 📌 copies come from the
 * agent's own bot: where the Mini App is that bot's (route a, the DM's `?j=` pet) the pet asks Telegram for write
 * access (feature-detected, skipped when already allowed); where it is the manager bot's (route b, the server sets
 * `dm`) that grant would go to the wrong bot, so the pet offers the agent's DM instead (Start allows its messages).
 * The auto-open is cancelled by any tap; the first GET retries twice, then the halo offers a retry. Every call is the
 * session's own (aborted on switch); a circle_* error is shown in place and never ends the pet.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CircleDecisionRequest, PetCircle, PetNote, PetNotesResponse } from '@/lib/pet/types';
import type { PetApi } from './contract';
import { circleCopy, circleLang, type CircleLang } from './circle-copy';
import { isPetError } from './errors';
import { backButton, confirmNative, openDm, tg } from './telegram';
import './circle.css';

type Choice = CircleDecisionRequest['choice'];
type Sheet = 'join' | 'notes' | null;
/** The sheet's slide-out before it unmounts (circle.css .pc-sheet[data-out]). */
const OUT_MS = 260;
/** The open sequence's hello reads first; then a never-chosen person sees the sheet. */
const AUTO_OPEN_MS = 1500;
const eventId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
const unchosen = (c: PetCircle) => c.myState === null || c.myState === 'left';
/** The first GET's retries (a weak connection, a 429, a store blip); then the halo offers one. */
const RETRY_MS = [1200, 3600];
const retryable = (e: unknown) => isPetError(e) && (e.code === 'network' || e.code === 'rate_limited' || e.code === 'circle_failed');

export interface CircleProps {
  api: PetApi;
  agentId: string;
  code: string;
  /** joined: a joyful hop; everyone: the full-house sparkle (PetApp runs it on an awake pet) */
  onJoy(why: 'bond' | 'win'): void;
}

export function Circle({ api, agentId, code, onJoy }: CircleProps) {
  const lang: CircleLang = circleLang(tg()?.initDataUnsafe?.user?.language_code);
  const t = circleCopy(lang);
  const [circle, setCircle] = useState<PetCircle | null>(null);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [out, setOut] = useState(false);
  const [notes, setNotes] = useState<PetNotesResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [say, setSay] = useState<string | null>(null);
  const [joy, setJoy] = useState(false);
  const [lost, setLost] = useState(false);
  const [invite, setInvite] = useState(false);
  const autoOpened = useRef(false);
  /** Any open, close or choice: the one-time auto-open never fires after it. */
  const touched = useRef(false);
  const asked = useRef(false);
  const alive = useRef(true);
  const halo = useRef<HTMLButtonElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const later = useCallback((ms: number, fn: () => void) => {
    const id = setTimeout(() => { timers.current.delete(id); fn(); }, ms);
    timers.current.add(id);
  }, []);
  useEffect(() => { const pending = timers.current; alive.current = true; return () => { alive.current = false; for (const id of pending) clearTimeout(id); }; }, []);

  const send = useCallback(<T,>(method: 'GET' | 'POST' | 'DELETE', action: string, body?: unknown) => api.send!<T>(agentId, method, action, body), [api, agentId]);
  const q = `code=${encodeURIComponent(code)}`;

  const explain = useCallback((e: unknown) => {
    if (!isPetError(e)) return t.failed;
    return e.code === 'circle_stale' ? t.stale : e.code === 'circle_full' ? t.full : e.code === 'circle_not_member' ? t.notMember
      : e.code === 'circle_use_vox' ? t.useVox : e.code === 'session_expired' ? t.reopen : t.failed;
  }, [t]);

  const load = useCallback((attempt = 0) => {
    setLost(false);
    send<PetCircle>('GET', `circle?${q}`).then((c) => {
      if (!alive.current) return;
      setCircle(c);
      // Once, only for someone who never chose here, and only if they have not tapped anything meanwhile.
      if (unchosen(c) && !autoOpened.current) { autoOpened.current = true; later(AUTO_OPEN_MS, () => { if (!touched.current) setSheet((s) => s ?? 'join'); }); }
    }).catch((e) => {
      if (!alive.current) return;
      // Not this group's member: one quiet line, nothing about the group. Circles off or no circle: nothing at all.
      if (isPetError(e) && e.code === 'circle_not_member') { setSay(t.notMember); later(4000, () => setSay(null)); }
      else if (retryable(e)) { if (attempt < RETRY_MS.length) later(RETRY_MS[attempt], () => load(attempt + 1)); else setLost(true); }
    });
  }, [send, q, later, t]);
  useEffect(() => { load(); }, [load]);

  const close = useCallback(() => {
    touched.current = true;
    setOut(true);
    later(OUT_MS, () => { setSheet(null); setOut(false); setSay(null); });
  }, [later]);
  const open = useCallback((s: Exclude<Sheet, null>) => { touched.current = true; setOut(false); setSay(null); setSheet(s); }, []);

  // Focus into the sheet when it opens (screen readers hear it, even the one-time auto-open); back to the halo after.
  const hadSheet = useRef(false);
  useEffect(() => {
    if (sheet) title.current?.focus();
    else if (hadSheet.current) halo.current?.focus();
    hadSheet.current = !!sheet;
  }, [sheet]);

  // Telegram's back button and Escape close the sheet.
  useEffect(() => {
    if (!sheet) return;
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', key);
    const off = backButton(close);
    return () => { window.removeEventListener('keydown', key); off(); };
  }, [sheet, close]);

  useEffect(() => {
    if (sheet !== 'notes') return;
    let live = true;
    setNotes(null);
    setInvite(false);
    send<PetNotesResponse>('GET', `notes?${q}`).then((n) => { if (live) setNotes(n); }).catch((e) => { if (live) setSay(explain(e)); });
    return () => { live = false; };
  }, [sheet, send, q, explain]);

  /**
   * After a Join: the agent's own bot sends the 📌 copies. Its write access can only be asked where this Mini App is that
   * bot's; on the manager's (dm set) the person starts the agent's DM instead. Once per session.
   */
  function allowCopies(next: PetCircle) {
    if (asked.current) return;
    asked.current = true;
    if (next.dm) { setInvite(true); return; }
    const app = tg();
    if (app?.initDataUnsafe?.user?.allows_write_to_pm) return;
    try { app?.requestWriteAccess?.(() => undefined); } catch { /* unsupported */ }
  }

  async function choose(choice: Choice) {
    if (!circle || busy) return;
    touched.current = true;
    setBusy(true); setSay(null);
    try {
      const was = circle.myState;
      const next = await send<PetCircle>('POST', 'circle/decision', { code, choice, revision: circle.card.revision, eventId: eventId() } satisfies CircleDecisionRequest);
      setCircle(next);
      close();
      if (choice === 'joined' && was !== 'joined') {
        later(OUT_MS + 80, () => { onJoy('bond'); setJoy(true); later(1600, () => setJoy(false)); });
        if (next.on) later(OUT_MS + 1500, () => onJoy('win'));
        allowCopies(next);
      }
    } catch (e) {
      setSay(explain(e));
      // The card changed: show the newest one in place, never a silent retry.
      if (isPetError(e) && e.code === 'circle_stale') await send<PetCircle>('GET', `circle?${q}`).then(setCircle).catch(() => undefined);
    } finally { setBusy(false); }
  }

  async function erase(note: PetNote) {
    if (busy || !await confirmNative(t.eraseAsk)) return;
    setBusy(true);
    try {
      await send<{ erased: boolean }>('DELETE', `notes/${encodeURIComponent(note.copyId)}`);
      const drop = (list: PetNote[]) => list.filter((n) => n.copyId !== note.copyId);
      setNotes((n) => n && { mine: drop(n.mine), group: drop(n.group) });
    } catch (e) { setSay(explain(e)); } finally { setBusy(false); }
  }

  async function leave() {
    if (!circle || busy || !await confirmNative(t.leaveAsk(circle.chatTitle))) return;
    setBusy(true);
    try {
      await send<{ left: boolean }>('POST', 'circle/leave', { code });
      setCircle(await send<PetCircle>('GET', `circle?${q}`));
      setInvite(false);
      close();
      // After the sheet is gone (closing clears its notes): one quiet line that they are out.
      later(OUT_MS + 20, () => { setSay(t.left); later(3200, () => setSay((s) => (s === t.left ? null : s))); });
    } catch (e) { setSay(explain(e)); } finally { setBusy(false); }
  }

  if (!circle) {
    if (say) return <div className="pc-say" role="status">{say}</div>;
    return lost ? <button type="button" className="pc-halo" data-lost="" dir={lang === 'fa' ? 'rtl' : 'ltr'} onClick={() => load()}>
      <span className="pc-halo-ring" aria-hidden="true">🐾</span><span>{t.retry}</span></button> : null;
  }
  const joined = circle.myState === 'joined', dm = circle.dm;
  const toDm = () => { if (dm) openDm(dm.bot); setInvite(false); };
  const cardDir = circle.card.locale === 'fa' ? 'rtl' : 'ltr', dir = lang === 'fa' ? 'rtl' : 'ltr';
  return (
    <>
      <button ref={halo} type="button" className="pc-halo" data-joined={joined ? '' : undefined} data-joy={joy ? '' : undefined} dir={dir}
        onClick={() => open(joined ? 'notes' : 'join')} aria-haspopup="dialog">
        <span className="pc-halo-ring" aria-hidden="true">🐾</span>
        <span>{joined ? t.here(circle.joined, circle.total) : unchosen(circle) ? t.join : t.notes}</span>
      </button>
      {say && !sheet && <div className="pc-say" role="status">{say}</div>}
      {invite && dm && joined && !sheet && !say && <button type="button" className="pc-say pc-dm" onClick={toDm}>{t.copiesIn(dm.name)}</button>}
      {sheet && <div className="pc-scrim" data-out={out ? '' : undefined} onClick={close} />}
      {sheet === 'join' && (
        <section className="pc-sheet" role="dialog" aria-modal="true" aria-labelledby="pc-title" data-out={out ? '' : undefined} dir={dir}>
          <div className="pc-handle" aria-hidden="true" />
          <h2 ref={title} tabIndex={-1} id="pc-title" className="pc-title" dir="auto">{circle.chatTitle}</h2>
          {circle.myState && circle.myState !== 'left' && t.chose[circle.myState] && <p className="pc-now">{t.chose[circle.myState]}</p>}
          <div className="pc-scroll">
            <p className="pc-notice" dir={cardDir}>{circle.card.copy.notice}</p>
          </div>
          {say && <p className="pc-alert" role="alert">{say}</p>}
          <div className="pc-choices" dir={cardDir} aria-busy={busy}>
            <button type="button" className="pc-btn" data-primary="" aria-pressed={circle.myState === 'joined'} disabled={busy} onClick={() => void choose('joined')}>{circle.card.copy.join}</button>
            <button type="button" className="pc-btn" aria-pressed={circle.myState === 'reply_only'} disabled={busy} onClick={() => void choose('reply_only')}>{circle.card.copy.reply}</button>
            <button type="button" className="pc-btn" aria-pressed={circle.myState === 'declined'} disabled={busy} onClick={() => void choose('declined')}>{circle.card.copy.decline}</button>
          </div>
          <div className="pc-foot">
            <button type="button" className="pc-link" onClick={() => open('notes')}>{t.seeNotes}</button>
            <button type="button" className="pc-link" onClick={close}>{t.notNow}</button>
          </div>
        </section>
      )}
      {sheet === 'notes' && (
        <section className="pc-sheet" role="dialog" aria-modal="true" aria-labelledby="pc-title" data-out={out ? '' : undefined} dir={dir}>
          <div className="pc-handle" aria-hidden="true" />
          <h2 ref={title} tabIndex={-1} id="pc-title" className="pc-title" dir="auto">{circle.chatTitle}</h2>
          {joined && <p className="pc-now">{t.here(circle.joined, circle.total)}{circle.members?.length ? ` · ${t.with(circle.members)}` : ''}</p>}
          {say && <p className="pc-alert" role="alert">{say}</p>}
          <div className="pc-scroll" aria-busy={!notes}>
            {!notes && !say && <ul className="pc-polaroids" aria-hidden="true">{[0, 1].map((i) => <li key={i} className="pc-polaroid pc-ghost" />)}</ul>}
            {notes && <Polaroids title={t.fromGroup} notes={notes.group} t={t} lang={lang} onErase={erase} busy={busy} />}
            {notes && <Polaroids title={t.myNotes} notes={notes.mine} t={t} lang={lang} onErase={erase} busy={busy} />}
            {notes && !notes.group.length && !notes.mine.length && <p className="pc-empty">{t.empty}</p>}
          </div>
          {joined && dm && <button type="button" className="pc-link pc-dm-link" onClick={toDm}>{t.copiesIn(dm.name)}</button>}
          <div className="pc-foot">
            {joined ? <button type="button" className="pc-link pc-danger" disabled={busy} onClick={() => void leave()}>{t.leave}</button>
              : <button type="button" className="pc-link" onClick={() => open('join')}>{t.join}</button>}
            <button type="button" className="pc-link" onClick={close}>{t.notNow}</button>
          </div>
        </section>
      )}
    </>
  );
}

/** A slight, stable tilt per note (from its id), so the stack reads hand-placed and never reshuffles. */
const tilt = (id: string) => { let h = 0; for (const c of id) h = (h * 31 + c.charCodeAt(0)) | 0; return ((h % 5) - 2) * 0.8; };

function Polaroids({ title, notes, t, lang, onErase, busy }: { title: string; notes: PetNote[]; t: ReturnType<typeof circleCopy>; lang: CircleLang; onErase(n: PetNote): void; busy: boolean }) {
  if (!notes.length) return null;
  return (
    <section className="pc-group" aria-label={title}>
      <h3 className="pc-group-title">{title}</h3>
      <ul className="pc-polaroids">
        {notes.map((n, i) => (
          <li key={n.copyId} className="pc-polaroid" style={{ '--r': `${tilt(n.copyId)}deg`, '--d': `${Math.min(i, 8) * 60}ms` } as React.CSSProperties}>
            <p className="pc-photo" dir="auto">{n.text}</p>
            <p className="pc-caption">
              <time dateTime={n.savedAt}>{new Date(n.savedAt).toLocaleDateString(lang === 'fa' ? 'fa-IR' : undefined)}</time>
              {n.groupTitle ? <span dir="auto"> · {t.from(n.groupTitle)}</span> : null}
              {n.byMe ? <span> · {t.byYou}</span> : null}
            </p>
            <button type="button" className="pc-erase" disabled={busy} onClick={() => onErase(n)}>{t.erase}</button>
          </li>
        ))}
      </ul>
    </section>
  );
}
