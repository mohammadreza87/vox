'use client';

/**
 * Wave C's asks and check-in moments, inside the lazy Extras chunk (never the route):
 *
 * - P1 check-ins (§5.2, §6.2) at the end of a session on a second different day, or the day before a stage-up in the
 *   forming week, with "Choose moments"; the yes goes to POST …/checkins, then P2 (Telegram's write access) when the
 *   bot may not message the person yet. The paused note (§5.4) once per pause, on the next open.
 * - P7 a share card after a stage-up, a bloom or a festival; P8 the home-screen shortcut on a third different day;
 *   P9 "learn my favourites" after several different games on several days.
 * - `?ci=` (§5.1): the check-in's moment replays instead of the hello (PetApp skips the hello when `view.checkin` is set).
 * - pet_action (§8.4): petAction.ts, after the spoken reply.
 *
 * One proactive ask a session, never in the first thirty seconds, never during a care animation, a talk turn, a sheet
 * or a game; "Not now" is the second button at the same size and never blocks anything (§6.1). Every ask is recorded
 * with the play ops askSeen / askAccepted / askDeclined; grants live with their purpose (check-ins on the server).
 */

import { useEffect, useRef, useState } from 'react';
import { isGoodbye } from '@/lib/pet/goodbye';
import type { AskId } from '@/lib/pet/play';
import { askOk, ASK_RULES, CHECKIN_DEFAULTS, CHECKIN_TYPES, eventId, p1Due, p8Due, p9Due, PAUSED_KEY, pausedStamp, replayOf, type Replay } from './askRules';
import type { CheckinPrefs, CheckinTypes } from './contract';
import type { HostSignal, PetHost } from './host';
import { watchPetActions } from './petAction';
import { roomIntent } from './rooms/intent';
import { backdrop } from './scene';
import type { MomentKind, ShareResult } from './share';
import { Sheet } from './Sheet';
import { t, type PetStringKey } from './strings';
import { canWrite, homeScreenStatus } from './telegram-more';
import { firstName, tg } from './telegram';
import { readSignals } from './tips';

type Moment = { kind: MomentKind; id?: string };
export type AskSheet =
  | { kind: 'P1'; forming: boolean; choose: boolean; types: CheckinTypes; at: number }
  | { kind: 'P2' }
  | { kind: 'P7'; moment: Moment }
  | { kind: 'P8' }
  | { kind: 'P9' }
  | { kind: 'paused' };
type Want = { kind: 'P7'; moment: Moment; until: number } | { kind: 'P8' | 'P9' | 'paused'; until: number } | { kind: 'P1'; until: number };

/** A wanted ask waits this long for a calm moment, then lets go (the situation it served has passed). */
const WANT_MS = 3 * 60_000;
/** P1's "end of a session": nothing has happened for this long, after something did, this far into the session */
const WIND_DOWN_MS = 12_000;
const MIN_SESSION_MS = 60_000;
const CALM_MS = 2500;
/** the paused note first, then the asks in the order their situation is rarest (§6.2) */
const ORDER: Want['kind'][] = ['paused', 'P1', 'P7', 'P9', 'P8'];
const CAT: Record<keyof CheckinTypes, PetStringKey> = { growingUp: 'ci.cat.growing', seasons: 'ci.cat.seasons', garden: 'ci.cat.garden', hellos: 'ci.cat.hellos', careNudges: 'ci.cat.care' };

/** the card's top colour: the agent's own backdrop edge */
const edge = (v: ReturnType<PetHost['view']>) => { try { return v ? backdrop(v.look).edge : '#16191E'; } catch { return '#16191E'; } };

const store = {
  get(k: string) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

export function Asks({ host }: { host: PetHost }) {
  const lang = host.lang;
  const [sheet, setSheet] = useState<AskSheet | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const sheetRef = useRef(sheet);
  sheetRef.current = sheet;
  const prefs = useRef<CheckinPrefs | null>(null);
  const share = useRef<Promise<{ run(): Promise<ShareResult> }> | null>(null);
  const laterRef = useRef<(ms: number, fn: () => void) => void>(() => {});

  useEffect(() => {
    const id = host.agentId;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const later = (ms: number, fn: () => void) => { const h = setTimeout(() => { timers.delete(h); fn(); }, ms); timers.add(h); };
    laterRef.current = later;
    const v0 = host.view();
    const guest = !v0 || v0.role === 'guest' || !!v0.talkInDm;
    let asked = false;
    let acted = false;
    let ending = false;
    let lastCare = -Infinity;
    const wants: Want[] = [];
    const want = (w: Omit<Want, 'until'> & { moment?: Moment }) => {
      if (guest || asked) return;
      const i = wants.findIndex((x) => x.kind === w.kind);
      if (i >= 0) wants.splice(i, 1);
      wants.push({ ...w, until: performance.now() + WANT_MS } as Want);
    };

    const offActions = watchPetActions(host, later);

    /* ---- a check-in's moment, instead of the hello ---- */
    const replay = (r: Replay) => {
      const e = host.engine(), v = host.view();
      if (!e || !v || v.care.asleep) return;
      switch (r) {
        case 'stage': case 'formed':
          // a stage-up not seen yet plays as the open event; one already seen gets the stage celebration again
          if (!v.stageUp) e.fire({ type: 'celebrate', why: 'stage' });
          if (r === 'formed') host.say(t('say.formed', undefined, lang));
          want({ kind: 'P7', moment: { kind: 'stage' } });
          break;
        case 'bloom': roomIntent.bloom = true; host.setRoom('garden'); break;
        case 'yalda': case 'suri': case 'nowruz': {
          e.fire({ type: 'celebrate', why: 'win' });
          host.say(t(`season.${r}.hello` as PetStringKey, undefined, lang));
          // the festival's keepsake and page (idempotent; out of season or celebrated elsewhere is a quiet no)
          void host.play({ op: 'seasonCelebrated', season: r });
          want({ kind: 'P7', moment: { kind: 'season', id: r } });
          break;
        }
        case 'move': e.fire({ type: 'celebrate', why: 'bond' }); break;
        case 'sleepy': host.setRoom('bedroom'); e.fire({ type: 'hello', firstName: firstName() }); break;
        case 'guess': roomIntent.guess = 'resume'; host.setRoom('play'); break;
        default: e.fire({ type: 'hello', firstName: firstName() });
      }
    };
    if (v0?.checkin) later(250, () => replay(replayOf(v0.checkin?.momentId)));
    if (v0?.stageUp) want({ kind: 'P7', moment: { kind: 'stage' } });

    /* ---- what the server knows: check-in preferences (on the view, else GET …/checkins), a pause, the home-screen status ---- */
    const adopt = (p: CheckinPrefs) => {
      prefs.current = p;
      // the server says when the paused note is due (once per pause); this device also keeps the pause it showed
      const stamp = pausedStamp(p);
      if (p.pausedNote && stamp && store.get(PAUSED_KEY(id)) !== stamp) want({ kind: 'paused' });
    };
    if (!guest && v0?.play) {
      if (v0.checkins) adopt(v0.checkins);
      else host.api.checkins?.(id).then(adopt, () => { /* no route, or not for this person: no P1, no paused note */ });
    }
    if (!guest && p8Due(readSignals(id)) && askOk(v0?.play, 'P8', Date.now())) {
      void homeScreenStatus().then((s) => { if (s === 'missed' || s === 'unknown') want({ kind: 'P8' }); });
    }

    const p1Ready = () => {
      const p = prefs.current, v = host.view();
      // never asked while check-ins are switched off on the server (STUDIO_PET_CHECKINS): no consent for a thing that cannot happen
      if (!p || p.enabled || !p.live || !askOk(v?.play, 'P1', Date.now()) || !p1Due(readSignals(id), v?.formingDay)) return false;
      const now = performance.now();
      return ending || (acted && now - host.openedAt > MIN_SESSION_MS && now - host.lastActive() > WIND_DOWN_MS);
    };

    const calm = () => {
      const now = performance.now();
      return host.talk() === 'idle' && !host.bubbleShown() && !host.isBusy() && !sheetRef.current
        && now - host.openedAt > ASK_RULES.quietMs && now - host.lastActive() > CALM_MS && now - lastCare > ASK_RULES.careMs && !host.view()?.care.asleep;
    };

    const show = (w: Want) => {
      asked = true;
      wants.length = 0;
      const v = host.view();
      if (w.kind === 'paused') { const s = pausedStamp(prefs.current); if (s) store.set(PAUSED_KEY(id), s); setSheet({ kind: 'paused' }); return; }
      if (w.kind === 'P1') setSheet({ kind: 'P1', forming: p1Due(readSignals(id), v?.formingDay) === 'forming', choose: false, types: { ...CHECKIN_DEFAULTS, ...prefs.current?.types }, at: Date.now() });
      else if (w.kind === 'P7') {
        setSheet({ kind: 'P7', moment: w.moment });
        // the card is drawn while the sheet is read, so Share opens the device's sheet inside the tap
        share.current = import('./share').then((m) => m.prepareShare({
          root: host.root(), line: m.cardLine(w.moment.kind, v?.name ?? '', lang, w.moment.id), link: `https://t.me/${v?.botUsername ?? ''}`,
          color: edge(v), rtl: lang === 'fa',
        }));
      } else setSheet({ kind: w.kind });
      void host.play({ op: 'askSeen', ask: w.kind });
    };

    const tryAsk = () => {
      if (asked || guest || !calm()) return;
      const now = performance.now();
      for (let i = wants.length - 1; i >= 0; i--) if (wants[i].until < now) wants.splice(i, 1);
      const play = host.view()?.play;
      const ok = wants.filter((w) => w.kind === 'paused' || askOk(play, w.kind, Date.now()));
      if (p1Ready() && !ok.some((w) => w.kind === 'P1')) ok.push({ kind: 'P1', until: now + WANT_MS });
      ok.sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));
      // Decisions' pick (view.suggest.ask, `on` and calibrated only) reorders the asks already due; null: no ask this
      // session (the paused note is not an ask). It never makes an ask due.
      const hint = host.view()?.suggest?.ask;
      const due = hint === null ? ok.filter((w) => w.kind === 'paused') : ok;
      const first = due.find((w) => w.kind === 'paused') ?? due.find((w) => w.kind === hint) ?? due[0];
      if (first) show(first);
    };
    const tick = setInterval(tryAsk, 1000);

    const off = host.on((s: HostSignal) => {
      switch (s.type) {
        case 'care': case 'toy': case 'body': lastCare = performance.now(); acted = true; break;
        case 'typed': case 'held': acted = true; break;
        case 'reply': acted = true; if (isGoodbye(s.said)) ending = true; break;
        case 'moment': want({ kind: 'P7', moment: { kind: s.kind, id: s.id } }); break;
        case 'round': acted = true; if (p9Due(readSignals(id))) want({ kind: 'P9' }); break;
      }
    });
    return () => { off(); offActions(); clearInterval(tick); for (const h of timers) clearTimeout(h); };
  }, [host, lang]);

  useEffect(() => { host.busy('ask', !!sheet); }, [host, sheet]);
  useEffect(() => () => host.busy('ask', false), [host]);

  const record = (ask: AskId, yes: boolean) => { void host.play({ op: yes ? 'askAccepted' : 'askDeclined', ask }); };
  const say = (k: PetStringKey) => host.say(t(k, undefined, lang));
  const close = () => setSheet(null);

  async function answerP1(yes: boolean, s: Extract<AskSheet, { kind: 'P1' }>) {
    close();
    // every moment switched off in "Choose moments" is a no (the server refuses a first yes with nothing on)
    if (!yes || !Object.values(s.types).some(Boolean)) { record('P1', false); say('talk.checkinsDeclined'); return; }
    try {
      // the consent evidence (PRIV-029): which sheet, in which language, when it appeared; the server hashes the exact copy
      const consent = { variant: s.forming ? 'forming' as const : 'default' as const, lang, eventId: eventId(), presentedAt: Math.min(s.at, Date.now() - 1) };
      prefs.current = await host.api.checkins!(host.agentId, { enabled: true, types: s.types, consent });
    } catch { return; /* nothing was turned on, so nothing is recorded as a yes */ }
    record('P1', true);
    say('perm.P1.after.yes');
    // P2 only when the bot may not message the person yet (a group launch) and Telegram can ask
    if (!canWrite() && tg()?.requestWriteAccess) { setSheet({ kind: 'P2' }); void host.play({ op: 'askSeen', ask: 'P2' }); }
  }
  async function answerP2(yes: boolean) {
    close();
    const ok = yes && await (await import('./telegram-more')).requestWriteAccess();
    record('P2', ok);
    // declined: check-ins stay on as inbox-only; never asked again this session
    laterRef.current(yes ? 0 : 400, () => say(ok ? 'perm.P2.after.yes' : 'perm.P2.after.no'));
  }
  async function answerP7(yes: boolean) {
    close();
    record('P7', yes);
    if (!yes) { say('perm.P7.after.no'); return; }
    const r = await (await share.current)?.run();
    if (r === 'shared' || r === 'telegram') say('perm.P7.after.yes');
    else if (r === 'copied') { setNote(t('share.copied', undefined, lang)); laterRef.current(3200, () => setNote(null)); }
  }
  async function answerP8(yes: boolean) {
    close();
    record('P8', yes);
    if (!yes) { say('perm.P8.after.no'); return; }
    if (await (await import('./telegram-more')).addToHomeScreen()) say('perm.P8.after.yes');
  }
  function answerP9(yes: boolean) {
    close();
    // there is no pet-signed personalization route yet: the answer is recorded; suggestions stay this session's
    record('P9', yes);
    say(yes ? 'perm.P9.after.yes' : 'perm.P9.after.no');
  }
  async function answerPaused(yes: boolean) {
    close();
    try {
      prefs.current = await host.api.checkins!(host.agentId, { op: yes ? 'resume' : 'keepPaused' });
      if (yes) say('perm.P1.after.yes');
    } catch { /* stays paused */ }
  }

  const name = host.view()?.name ?? '';
  const v = { name };
  const no = t('perm.P1.no', undefined, lang);
  return (
    <>
      {sheet?.kind === 'P1' && (
        <Sheet title={t(sheet.forming ? 'perm.P1.forming.title' : 'perm.P1.title', v, lang)} body={sheet.choose ? undefined : t('perm.P1.body', v, lang)}
          yes={t(sheet.forming ? 'perm.P1.forming.yes' : 'perm.P1.yes', undefined, lang)} no={no}
          onYes={() => void answerP1(true, sheet)} onNo={() => void answerP1(false, sheet)}>
          <button type="button" className="pet-link pet-sheet-link" aria-expanded={sheet.choose} onClick={() => setSheet({ ...sheet, choose: !sheet.choose })}>{t('perm.P1.choose', undefined, lang)}</button>
          {sheet.choose && (
            <div className="pet-switches">
              {CHECKIN_TYPES.map((k) => (
                <label key={k}><span>{t(CAT[k], v, lang)}</span>
                  <input type="checkbox" role="switch" checked={sheet.types[k]} onChange={(e) => setSheet({ ...sheet, types: { ...sheet.types, [k]: e.target.checked } })} /></label>
              ))}
            </div>
          )}
        </Sheet>
      )}
      {sheet?.kind === 'P2' && <Sheet title={t('perm.P2.title', undefined, lang)} body={t('perm.P2.body', v, lang)} yes={t('perm.P2.yes', undefined, lang)} no={no}
        onYes={() => void answerP2(true)} onNo={() => void answerP2(false)} />}
      {sheet?.kind === 'P7' && <Sheet title={t('perm.P7.title', v, lang)} body={t('perm.P7.body', v, lang)} yes={t('perm.P7.yes', undefined, lang)} no={no}
        onYes={() => void answerP7(true)} onNo={() => void answerP7(false)} />}
      {sheet?.kind === 'P8' && <Sheet title={t('perm.P8.title', v, lang)} body={t('perm.P8.body', v, lang)} yes={t('perm.P8.yes', undefined, lang)} no={no}
        onYes={() => void answerP8(true)} onNo={() => void answerP8(false)} />}
      {sheet?.kind === 'P9' && <Sheet title={t('perm.P9.title', v, lang)} body={t('perm.P9.body', v, lang)} yes={t('perm.P9.yes', undefined, lang)} no={t('perm.P9.no', undefined, lang)}
        onYes={() => answerP9(true)} onNo={() => answerP9(false)} />}
      {sheet?.kind === 'paused' && <Sheet title={t('ci.paused.title', undefined, lang)} yes={t('ci.paused.yes', undefined, lang)} no={t('ci.paused.no', undefined, lang)}
        onYes={() => void answerPaused(true)} onNo={() => void answerPaused(false)} />}
      {note && <div className="pet-lit" role="status">{note}</div>}
    </>
  );
}
