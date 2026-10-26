'use client';

/**
 * The living page's Wave B layer, one lazy chunk mounted once the pet has said hello (it never delays the first
 * paint): tips v1 (§7), the growth watcher and its lit chip (§4.11, §10.3), the "remember this" confirm step, the
 * UX-02 mic sheet before the first hold (P3), and hands-free with its P3b sheet (§8A.2). It talks to the page only
 * through the PetHost (live getters, a few actions, a signal bus).
 */

import { useEffect, useRef, useState } from 'react';
import type { AskId, TipId } from '@/lib/pet/play';
import type { PetGrowthMoment, PetViewB } from './contract';
import { bestTaught, detailOf, detailsOf, newlyLit } from './growth';
import type { HandsFree, HandsFreeOff } from './handsFree';
import type { HostSignal, PetHost } from './host';
import { Sheet } from './Sheet';
import { t, type PetLang } from './strings';
import { countDay, countGame, readSignals, rankTips, writeSignals, type TipDef, type TipMoment, type TipSignals } from './tips';
import { Asks } from './Asks';
import './extras.css';

/** a tip waits this long after anything happened, and never in the first seconds of a session (§7.1, §6.1) */
const CALM_MS = 2500;
const OPEN_QUIET_MS = 6000;
/** a coach chip nobody touched goes away after this */
const COACH_MS = 9000;
/** two round ends shorter than this, in a row, fit T6 */
const QUICK_ROUND_MS = 15_000;

const FSI = '⁨', PDI = '⁩';

/**
 * UX-02 as drafted (PRIVACY_AND_CONSENT.md §8; legal text, not in the keys file). The provider sentence needs every fact
 * (providers, locations, retention); until they are resolved (a legal to-do) it is a neutral line pointing to Privacy
 * and memory, in the privacy doc's own words for that page. Pending legal review like the rest of UX-02.
 */
export function micSheet(lang: PetLang, n: PetViewB['voiceNotice']): { title: string; body: string; yes: string; no: string } {
  const full = n?.providers && n.locations && n.retention ? { ...n, locations: n.locations, retention: n.retention } : null;
  if (lang === 'fa') {
    const iso = (s: string) => `${FSI}${s}${PDI}`;
    const facts = full ? `صدای شما برای تبدیل به متن و پاسخ به درخواستتان به ${iso(full.providersFa ?? full.providers)} در ${iso(full.locationsFa ?? full.locations)} فرستاده می‌شود. ${full.retentionFa ?? ''} `
      : 'صدای شما برای تبدیل به متن و پاسخ به درخواستتان به ارائه‌دهندگان خدمات صوتی فرستاده می‌شود؛ فهرست آن‌ها در «حریم خصوصی و حافظه» آمده است. ';
    return { title: 'برای این گفتگو از میکروفون استفاده می‌کنید؟', body: `${facts}با این کار، شناسایی گوینده از روی صدا فعال نمی‌شود.`.replace(/\s+/g, ' ').trim(),
      yes: 'استفاده از میکروفون', no: 'استفاده از متن' };
  }
  const facts = full ? `Your audio will be sent to ${full.providers} in ${full.locations} to transcribe and answer your request. ${full.retention} `
    : 'Your audio will be sent to our voice providers, listed in Privacy and memory, to transcribe and answer your request. ';
  return { title: 'Use your microphone for this conversation?', body: `${facts}This does not turn on voice recognition.`.replace(/\s+/g, ' ').trim(),
    yes: 'Use microphone', no: 'Use text' };
}

/** Hidden when either is missing (some iOS Telegram WebViews, older Android ones): hold-to-talk stays. */
export const handsFreeSupported = () => typeof window !== 'undefined' && typeof AudioWorkletNode !== 'undefined'
  && typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;

const store = {
  get(k: string) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};
/** device-local: the UX-02 sheet was answered yes on this device, the P3b sheet too (the hands-free switch itself starts off) */
export const MIC_KEY = (agentId: string) => `vox.pet.mic.${agentId}`;
export const HF_KEY = (agentId: string) => `vox.pet.handsfree.${agentId}`;

/** The server recorded a yes for this ask (Wave B `askAccepted`; the field name is the server's, read defensively). */
const accepted = (v: PetViewB | null, ask: AskId) => {
  const a = v?.play?.asks[ask] as { accepted?: unknown; acceptedAt?: unknown } | undefined;
  return !!(a && (a.accepted || a.acceptedAt));
};

type SheetState = { kind: 'mic'; then?: 'hf' } | { kind: 'hf' } | { kind: 'confirm'; m: PetGrowthMoment };
interface Coach { tip: TipDef; x: number; y: number; above: boolean; why: boolean; ignoredBefore: boolean }

export default function Extras({ host }: { host: PetHost }) {
  const lang = host.lang;
  const [sheet, setSheet] = useState<SheetState | null>(null);
  const [coach, setCoach] = useState<Coach | null>(null);
  const [lit, setLit] = useState<string | null>(null);
  const sheetRef = useRef(sheet);
  sheetRef.current = sheet;
  const hf = useRef<HandsFree | null>(null);
  const hfDeclined = useRef(false);
  const micYes = useRef(false);

  useEffect(() => {
    const id = host.agentId;
    const sig: TipSignals = readSignals(id);
    const v0 = host.view();
    const openedAsleep = !!v0?.care.asleep;
    sig.sessions = Math.min(99, sig.sessions + 1);
    if (openedAsleep) sig.quietOpens = Math.min(99, sig.quietOpens + 1);
    countDay(sig);
    writeSignals(id, sig);
    const moment: TipMoment = { care: null, hour: new Date().getHours(), micAvailable: v0?.listen !== false, openedAsleep, grown: false, settled: false, quickRounds: 0,
      checkinOpened: !!v0?.checkin };
    // T13 and T14 read the record: a seed ever planted (a bloom page counts), a keepsake in the closet
    const fromPlay = () => { const p = host.view()?.play; if (p) { moment.planted = !!p.garden || p.book.some((b) => b.id === 'bloom'); moment.keepsake = p.items.length > 0; } };
    fromPlay();
    // the person's closet overlay and garden seed on the character, in every room (motion engineer's floor and outfit layers)
    let worn: unknown = null, sown: unknown = null;
    const dress = () => {
      const p = host.view()?.play, e = host.engine();
      if (!p || !e) return;
      if (p.wearing !== worn) { worn = p.wearing; e.setWearing?.(p.wearing); }
      if (p.garden !== sown) { sown = p.garden; e.setGarden?.(p.garden && p.garden.state !== 'empty' ? { state: p.garden.state, seed: p.garden.seed } : null); }
    };
    dress();
    // ?mock=1&room=garden: a demo opens in that room (mock mode only; a real open starts at Home)
    const q = new URLSearchParams(location.search);
    const startRoom = q.get('mock') === '1' ? q.get('room') : null;
    if (startRoom && ['play', 'garden', 'closet', 'bedroom', 'book'].includes(startRoom)) host.setRoom(startRoom as never);
    let tipShown = false;
    let bubbleTip: { tip: TipDef; until: number } | null = null;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const later = (ms: number, fn: () => void) => { const h = setTimeout(() => { timers.delete(h); fn(); }, ms); timers.add(h); };
    const bump = (k: keyof TipSignals) => { const v = sig[k]; (sig as unknown as Record<string, unknown>)[k] = typeof v === 'number' ? Math.min(99, v + 1) : true; writeSignals(id, sig); };

    /* ---- the mic sheet gate: only with a play record (the ask is recorded there) and no yes yet ---- */
    micYes.current = !v0?.play || accepted(v0, 'P3') || store.get(MIC_KEY(id)) === '1';
    host.micOk(micYes.current);

    /* ---- hands-free switch: offered where the device can and the server hears ---- */
    if (handsFreeSupported() && v0?.listen !== false && v0?.role !== 'guest' && !v0?.talkInDm) host.setVoice({ handsFree: true });

    /* ---- growth: draw what is already lit; light what lights from here on ---- */
    let growth = v0?.growth;
    host.engine()?.setDetails?.(detailsOf(growth));
    const lighting: PetGrowthMoment[] = [];
    let peak: (() => void) | null = null;
    const lightNext = () => {
      const m = lighting.shift();
      if (!m) return;
      const e = host.engine();
      const show = () => {
        peak = null;
        host.engine()?.setDetails?.(detailsOf(growth));
        if (m.title) host.say(m.title);
        setLit(m.id);
        later(3200, () => { setLit((x) => (x === m.id ? null : x)); lightNext(); });
      };
      e?.lightMoment?.(detailOf(m));
      // the detail fades in at the glow's peak (motion cue); without the motion layer, after the look-up beat
      peak = show;
      later(e?.onMotion ? 1600 : 700, () => { if (peak === show) show(); });
    };

    /* ---- tips ---- */
    const calm = () => {
      const now = performance.now();
      return host.talk() === 'idle' && !host.bubbleShown() && !host.isBusy() && !sheetRef.current
        && now - host.lastActive() > CALM_MS && now - host.openedAt > OPEN_QUIET_MS;
    };
    const target = (d: TipDef): HTMLElement | null => {
      if (d.place.kind !== 'coach') return null;
      const root = host.root();
      const sel = d.place.target === 'mic' ? '.pet-mic' : `.pet-room[data-room="${d.place.target.slice(5)}"]`;
      const el = root?.querySelector<HTMLElement>(sel) ?? null;
      const r = el?.getBoundingClientRect();
      return r && r.width > 0 ? el : null;
    };
    const record = (tip: TipId, op: 'tipSeen' | 'tipDismissed') => { void host.play({ op, tip }); };
    const show = (d: TipDef) => {
      const play = host.view()?.play;
      const before = play?.tips[d.id]?.shown ?? 0;
      if (d.place.kind === 'coach') {
        const el = target(d);
        if (!el) return false;
        const r = el.getBoundingClientRect();
        const above = r.bottom + 72 > window.innerHeight;
        setCoach({ tip: d, x: r.left + r.width / 2, y: above ? r.top - 8 : r.bottom + 8, above, why: false, ignoredBefore: before > 0 });
        later(COACH_MS, () => setCoach((c) => {
          // ignoring a tip twice counts as dismissing it (§7.1)
          if (c?.tip.id === d.id && c.ignoredBefore) record(d.id, 'tipDismissed');
          return c?.tip.id === d.id ? null : c;
        }));
      } else if (d.place.kind === 'wiggle') {
        const el = host.toy(d.place.toy);
        if (!el) return false;
        el.setAttribute('data-tip', '');
        later(2600, () => {
          el.removeAttribute('data-tip');
          if (d.place.kind === 'wiggle' && d.place.then === 'bubble' && host.say(t(d.line, undefined, lang))) bubbleTip = { tip: d, until: performance.now() + 8000 };
        });
      } else {
        if (!host.say(t(d.line, undefined, lang))) return false;
        bubbleTip = { tip: d, until: performance.now() + 8000 };
      }
      record(d.id, 'tipSeen');
      return true;
    };
    const tryTip = () => {
      if (tipShown || !calm()) return;
      moment.care = host.care();
      const v = host.view();
      const d = rankTips(v?.play, sig, moment, tipShown, undefined, v?.suggest?.tip);
      if (d && show(d)) tipShown = true;
    };
    const tick = setInterval(tryTip, 2000);

    /* ---- hands-free ---- */
    const startHf = async () => {
      host.setVoice({ open: true, hearing: false });
      try {
        const m = await import('./handsFree');
        hf.current = await m.startHandsFree({
          ctx: host.audio,
          busy: () => { const s = host.talk(); return s === 'thinking' ? 'thinking' : s === 'speaking' ? 'speaking' : 'idle'; },
          bargeIn: () => host.hush(),
          onHear: () => { host.setVoice({ hearing: true }); host.engine()?.setListening?.(true); },
          onUtterance: (blob) => { host.setVoice({ hearing: false }); host.sendVoice(blob, true); },
          onOff: (why: HandsFreeOff) => {
            hf.current = null;
            host.setVoice({ open: false, hearing: false, ...(why === 'idle' || why === 'hidden' ? { note: t('voice.autoOff', undefined, lang) } : {}) });
            host.engine()?.setListening?.(false);
            if (why === 'denied') host.say(t('talk.micBlocked', undefined, lang));
          },
        });
        host.engine()?.setListening?.(true);
      } catch {
        host.setVoice({ open: false, hearing: false, note: t('voice.unavailable', undefined, lang) });
      }
    };

    const off = host.on((s: HostSignal) => {
      switch (s.type) {
        case 'toy':
          if (s.e.type === 'cookieTap') bump('cookieTaps');
          if (s.e.type === 'cookieLift') bump('drags');
          if (s.e.type === 'moonTap') bump('moonUsed');
          if (s.e.type === 'ballTap' && !s.e.at) { countGame(sig, 'bop'); writeSignals(id, sig); }
          break;
        case 'body': if (!sig.touched) bump('touched'); bump('pokes'); break;
        case 'care': if (s.action === 'pet') bump('strokes'); break;
        case 'typed': bump('typed'); break;
        case 'held': bump('held'); break;
        case 'room':
          if (s.room === 'play' && !sig.playOpened) bump('playOpened');
          if (s.room === 'closet' && !sig.closetOpened) bump('closetOpened');
          break;
        case 'round':
          if (s.game) { countGame(sig, s.game); writeSignals(id, sig); }
          moment.quickRounds = !s.zen && s.ms < QUICK_ROUND_MS ? moment.quickRounds + 1 : 0; tryTip(); break;
        case 'motion':
          if (s.cue.type === 'settle') { moment.settled = true; tryTip(); }
          if (s.cue.type === 'litPeak' && peak) peak();
          break;
        case 'bubbleHold':
          if (bubbleTip && bubbleTip.until > performance.now() && bubbleTip.tip.why) { host.say(t(bubbleTip.tip.why, undefined, lang)); bubbleTip = null; }
          break;
        case 'view': {
          const v = host.view();
          if (v?.stageUp || v?.play?.book.some((b) => b.id.startsWith('stage'))) moment.grown = true;
          fromPlay();
          dress();
          const next = v?.growth;
          const fresh = newlyLit(growth, next);
          growth = next ?? growth;
          if (fresh.length) { const idle = !lighting.length && !peak; lighting.push(...fresh); if (idle) lightNext(); }
          break;
        }
        case 'reply': {
          if (!s.saved || sheetRef.current) break;
          const m = bestTaught(host.view()?.growth, s.said, s.moment);
          if (m && host.api.growthConfirm) setSheet({ kind: 'confirm', m });
          break;
        }
        case 'micAsk':
          if (sheetRef.current) break;
          setSheet({ kind: 'mic' });
          void host.play({ op: 'askSeen', ask: 'P3' });
          break;
        case 'handsFree':
          if (hf.current) { hf.current.stop('user'); break; }
          if (sheetRef.current || hfDeclined.current) break;
          if (!micYes.current) { setSheet({ kind: 'mic', then: 'hf' }); void host.play({ op: 'askSeen', ask: 'P3' }); break; }
          if (store.get(HF_KEY(id)) !== '1') { setSheet({ kind: 'hf' }); void host.play({ op: 'askSeen', ask: 'P3b' }); break; }
          void startHf();
          break;
      }
    });
    startHfRef.current = startHf;
    // the first view is the baseline: a refresh after this one can light moments
    if (v0?.stageUp || v0?.play?.book.some((b) => b.id.startsWith('stage'))) moment.grown = true;
    return () => {
      off();
      clearInterval(tick);
      for (const h of timers) clearTimeout(h);
      hf.current?.stop('closed');
      hf.current = null;
    };
  }, [host, lang]);

  const startHfRef = useRef<() => Promise<void>>(async () => {});
  useEffect(() => { host.busy('sheet', !!sheet); }, [host, sheet]);

  const close = () => setSheet(null);
  const answerMic = async (yes: boolean, then?: 'hf') => {
    close();
    const id = host.agentId;
    if (!yes) {
      void host.play({ op: 'askDeclined', ask: 'P3' });
      host.say(t('perm.P3.after.no', undefined, lang));
      host.focusTalk();
      return;
    }
    void host.play({ op: 'askAccepted', ask: 'P3' });
    store.set(MIC_KEY(id), '1');
    micYes.current = true;
    // the OS prompt only now, after the yes (UX-02); the stream is closed at once: the next hold records
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      for (const tr of s.getTracks()) tr.stop();
      host.micOk(true);
      if (then === 'hf') setSheet({ kind: 'hf' });
      else host.say(t('perm.P3.after.yes', undefined, lang));
    } catch {
      host.micOk(true);
      host.say(t('talk.micBlocked', undefined, lang));
      host.focusTalk();
    }
  };
  const answerHf = (yes: boolean) => {
    close();
    if (!yes) {
      void host.play({ op: 'askDeclined', ask: 'P3b' });
      // hold-to-talk stays; no re-ask this session (the switch goes)
      hfDeclined.current = true;
      host.setVoice({ handsFree: false });
      return;
    }
    void host.play({ op: 'askAccepted', ask: 'P3b' });
    store.set(HF_KEY(host.agentId), '1');
    void startHfRef.current();
  };
  const confirm = async (m: PetGrowthMoment, yes: boolean) => {
    close();
    if (!yes) return;
    try {
      const r = await host.api.growthConfirm?.(host.agentId, m.id);
      if (r?.growth) host.adoptGrowth(r.growth);
    } catch { /* the save stands; the moment simply did not light */ }
  };

  const v = host.view();
  const name = v?.name ?? '';
  return (
    <>
      {sheet?.kind === 'mic' && (() => {
        const c = micSheet(lang, v?.voiceNotice);
        return <Sheet {...c} onYes={() => void answerMic(true, sheet.then)} onNo={() => void answerMic(false)} />;
      })()}
      {sheet?.kind === 'hf' && <Sheet title={t('perm.P3b.title', undefined, lang)} body={t('perm.P3b.body', { name }, lang)}
        yes={t('perm.P3b.yes', undefined, lang)} no={t('perm.P3b.no', undefined, lang)} onYes={() => answerHf(true)} onNo={() => answerHf(false)} />}
      {sheet?.kind === 'confirm' && <Sheet title={t('growth.confirm.ask', { title: sheet.m.title }, lang)}
        yes={t('growth.confirm.yes', undefined, lang)} no={t('growth.confirm.no', undefined, lang)}
        onYes={() => void confirm(sheet.m, true)} onNo={() => void confirm(sheet.m, false)} />}
      {coach && (
        <div className="pet-coach" role="status" data-above={coach.above ? '' : undefined} style={{ left: coach.x, top: coach.y }}>
          <span>{t(coach.why && coach.tip.why ? coach.tip.why : coach.tip.line, undefined, lang)}</span>
          {coach.tip.why && <button type="button" aria-label={t('ci.btn.why', undefined, lang)} aria-pressed={coach.why} onClick={() => setCoach({ ...coach, why: !coach.why })}>ⓘ</button>}
          <button type="button" aria-label={t('ui.dismiss', undefined, lang)} onClick={() => { void host.play({ op: 'tipDismissed', tip: coach.tip.id }); setCoach(null); }}>×</button>
        </div>
      )}
      {lit && <div className="pet-lit" role="status">{t('growth.lit.chip', undefined, lang)}</div>}
      <Asks host={host} />
    </>
  );
}
