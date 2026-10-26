'use client';

import { flushSync } from 'react-dom';
import { domMin, LazyMotion } from 'framer-motion';
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Expression } from '@/lib/studio/character';
import { FULL_AT, TIRED_BELOW, type Mood, type NeedKey, type PetCare, type PetView, type Stage as StageN } from '@/lib/pet/types';
import { detectTier } from '../../_lib/motion';
import { pageActive, REDUCED_MOTION_QUERY, subscribeActivity } from '../../_components/motion/activity';
import { createPetEngine } from '../_engine/loop';
import type { Tier } from '../_engine/types';
import { createPetApi, isPetError } from './api';
import { moodOf } from './care-local';
import { CareSync, type CareUpdate } from './careSync';
import { type EngineCue, type PetApi, type PetEngine, type PetRequestOpts, type TalkState, type ToyEvent, type ToyKind } from './contract';
import { COPY, sayText } from './copy';
import { Bubble, REVEAL_CPS, Thought, type BubbleMsg } from './Bubble';
import { Dock, type Needs } from './Dock';
import { Particles } from './Particles';
import { PetRig } from './PetRig';
import type { SleeperKind } from './Sleeper';
import { Stage } from './Stage';
import { TalkPill } from './TalkPill';
import { backdrop, characterBox, daysTogether, PET_GROUND, sceneAnchors, type CharacterBox } from './scene';
import {
  bootTelegram, circleCode, closeApp, firstName, hideKeyboard, holdClosing, LAYOUT_EVENTS, openDm, openTelegram, paintChrome, clearLegacyPetSnapshots,
  readyAfterPaint, settingsButton, startAccelerometer, startIntent, syncSafeAreas, tg,
} from './telegram';

/* ---------- small helpers ---------- */

const needsOf = (c: PetCare): Needs => ({ tummy: c.tummy, joy: c.joy, energy: c.energy });
const sameMood = (a: Mood | null, b: Mood) => !!a && a.level === b.level && a.tone === b.tone && a.lowest === b.lowest && a.asleep === b.asleep;

function initialTier(): Tier {
  const q = new URLSearchParams(location.search).get('tier');
  if (q === 'full' || q === 'lite' || q === 'reduced') return q;
  let reduced = false;
  try { reduced = window.matchMedia(REDUCED_MOTION_QUERY).matches; } catch { /* old WebView */ }
  return detectTier(reduced);
}

function cssPx(name: string): number {
  try { return parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name)) || 0; } catch { return 0; }
}

/** The quiet screens load (with their CSS) only when one shows: the living page never carries them. */
const Sleeper = lazy(() => import('./Sleeper').then((m) => ({ default: m.Sleeper })));
/** Circles S4: the group halo and sheets, with their CSS, only for a page opened with a group code. */
const Circle = lazy(() => import('./Circle').then((m) => ({ default: m.Circle })));

/**
 * One AudioContext for the page, created and resumed inside the first pointerdown (Android gesture rule,
 * §3.5). `ctx` is the one made so far (null until a gesture made it): hiding the page reads it and never
 * creates one outside a gesture.
 */
function useAudio() {
  const ctx = useRef<AudioContext | null>(null);
  const get = useCallback(() => {
    if (!ctx.current && typeof window !== 'undefined') {
      const C = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      try { if (C) ctx.current = new C(); } catch { /* no audio */ }
    }
    return ctx.current;
  }, []);
  return { get, ctx };
}

/** A talk turn that hears nothing back in this long fails like any other (the pet never thinks forever). */
const TALK_TIMEOUT_MS = 45_000;

interface Fatal { kind: SleeperKind; look?: PetView['look']; stage?: StageN; name?: string }

/** Private state exists only inside one freshly verified foreground/session. Nothing is persisted. */
export function PetApp({ agentId, api }: { agentId: string; api?: PetApi }) {
  const [telegramReady, setTelegramReady] = useState(false);
  const [scope, setScope] = useState(() => ({ agentId, signed: tg()?.initData ?? '', generation: 0, active: true }));
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  useLayoutEffect(() => {
    setTelegramReady(true);
    clearLegacyPetSnapshots(agentId);
    const update = (activity = false) => {
      const previous = scopeRef.current;
      const signed = tg()?.initData ?? '';
      const identityChanged = previous.agentId !== agentId || previous.signed !== signed;
      const active = pageActive();
      if (!identityChanged && (!activity || (!active && !previous.active))) return;
      const next = { agentId, signed, generation: previous.generation + 1, active };
      scopeRef.current = next;
      // Native lifecycle callbacks must remove the previous account's DOM before the next paint.
      flushSync(() => setScope(next));
    };
    const off = subscribeActivity(() => update(true));
    const onPointer = () => update();
    document.addEventListener('pointerdown', onPointer, true);
    // Check the signed SDK session before every visible frame, including a switch without an event.
    let frame = 0;
    const checkFrame = () => { update(); frame = requestAnimationFrame(checkFrame); };
    frame = requestAnimationFrame(checkFrame);
    // A prop/identity change during React rendering is already before paint.
    const signed = tg()?.initData ?? '';
    if (scopeRef.current.agentId !== agentId || scopeRef.current.signed !== signed || !pageActive()) {
      setScope((s) => ({ agentId, signed, generation: s.generation + 1, active: pageActive() }));
    }
    return () => { off(); cancelAnimationFrame(frame); document.removeEventListener('pointerdown', onPointer, true); };
  }, [agentId]);
  const current = scope.agentId === agentId && scope.signed === (tg()?.initData ?? '');
  const app = tg();
  return <>
    {(!scope.active || !current) ? <main className="pet-root" data-pet-root="" data-paused="" style={{ backgroundColor: PET_GROUND }} /> :
    <PetSession key={`${agentId}:${scope.generation}`} agentId={agentId} injected={api} signed={scope.signed}
    onRetry={() => {
      // A retry starts with a fresh authenticated GET and fresh request/care/audio state.
      // Never retry across an account/foreground change.
      if (!pageActive() || scopeRef.current.agentId !== agentId || scopeRef.current.signed !== (tg()?.initData ?? '')) return;
      setScope((s) => ({ ...s, generation: s.generation + 1 }));
    }} />}
    {telegramReady && app?.initData && app.close && <button type="button" className="pet-close" style={{ position: 'fixed', zIndex: 20,
      top: 'calc(var(--pet-safe-top,env(safe-area-inset-top,0px)) + 8px)', right: 'max(12px,env(safe-area-inset-right,0px))' }}
      onClick={() => closeApp()}>{COPY.close}</button>}
  </>;
}

function PetSession({ agentId, injected, signed, onRetry }: { agentId: string; injected?: PetApi; signed: string; onRetry(): void }) {
  const baseApi = useMemo(() => injected ?? createPetApi(), [injected]);
  const alive = useRef(true);
  const allowed = useRef(true);
  const requests = useRef(new Set<AbortController>());
  const denyRef = useRef<(e: unknown) => void>(() => {});
  const valid = useCallback(() => alive.current && allowed.current && signed === (tg()?.initData ?? '') && pageActive(), [signed]);
  const api = useMemo<PetApi>(() => {
    const call = async <T,>(run: (o: PetRequestOpts) => Promise<T>, o: PetRequestOpts = {}): Promise<T> => {
      if (!valid()) throw new DOMException('Pet session ended', 'AbortError');
      const ac = new AbortController();
      const abort = () => ac.abort();
      o.signal?.addEventListener('abort', abort, { once: true });
      if (o.signal?.aborted) ac.abort();
      requests.current.add(ac);
      try {
        const result = await run({ ...o, signal: ac.signal });
        if (!valid() || ac.signal.aborted) throw new DOMException('Pet session ended', 'AbortError');
        return result;
      } catch (e) {
        // A circle_* refusal is the group sheet's to show, and an expired talk window the bubble's: neither ends the pet.
        if (valid() && isPetError(e) && ((e.status === 401 && e.code !== 'session_expired') || (e.status === 403 && !e.code.startsWith('circle')) || e.code === 'pet_unavailable')) denyRef.current(e);
        throw e;
      } finally { requests.current.delete(ac); o.signal?.removeEventListener('abort', abort); }
    };
    return {
      get: (id, o) => call((opts) => baseApi.get(id, opts), o),
      care: (id, req, o) => call((opts) => baseApi.care(id, req, opts), o),
      talk: (id, req, o) => call((opts) => baseApi.talk(id, req, opts), o),
      talkVoice: (id, blob, o) => call((opts) => baseApi.talkVoice(id, blob, opts), o),
      ...(baseApi.send ? { send: (id, method, action, body, o) => call((opts) => baseApi.send!(id, method, action, body, opts), o) } : {}),
    } as PetApi;
    // Each mounted session owns these refs and its signed authority; never re-used after a switch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseApi, signed]);
  const { get: audio, ctx: audioCtx } = useAudio();
  const [mounted, setMounted] = useState(false);
  const [view, setView] = useState<PetView | null>(null);
  const [fatal, setFatal] = useState<Fatal | null>(null);
  const [engine, setEngine] = useState<PetEngine | null>(null);
  const [tier, setTier] = useState<Tier>('full');
  const [stage, setStage] = useState<StageN>(1);
  const [expr, setExpr] = useState<Expression>('idle');
  const [needs, setNeeds] = useState<Needs | null>(null);
  const [mood, setMood] = useState<Mood | null>(null);
  const [talk, setTalk] = useState<TalkState>('idle');
  const [bubble, setBubble] = useState<BubbleMsg | null>(null);
  const [thought, setThought] = useState<NeedKey | null>(null);
  const [score, setScore] = useState<{ bops: number; misses: number } | null>(null);
  const [days, setDays] = useState<number | null>(null);
  const [focusTalk, setFocusTalk] = useState(false);
  const [box, setBox] = useState<CharacterBox>({ x: 0, y: 0, size: 200 });
  const [safeTop, setSafeTop] = useState(0);
  const code = useMemo(circleCode, []);

  const viewRef = useRef<PetView | null>(null);
  viewRef.current = view;
  const engineRef = useRef<PetEngine | null>(null);
  engineRef.current = engine;
  const moodRef = useRef<Mood | null>(null);
  const careRef = useRef<PetCare | null>(null);
  const talkRef = useRef<TalkState>('idle');
  const helloAt = useRef<number | null>(null);
  const conversationStarted = useRef(false);
  const queued = useRef<(() => void)[]>([]);
  const localGuard = useRef<Partial<Record<string, string>>>({});
  const closing = useRef<(() => void) | null>(null);
  const goodbye = useRef(false);
  const speakToken = useRef(0);
  /** the reply audio now playing (a new turn stops it) */
  const source = useRef<AudioBufferSourceNode | null>(null);
  /** a Bond milestone a talk reply crossed: it celebrates once the reply has been said */
  const milestone = useRef(false);
  /** celebrations that came while asleep: they play once the pet is awake (never on a sleeping pet) */
  const afterWake = useRef<(() => void)[]>([]);
  const rootRef = useRef<HTMLElement>(null);
  const toyEls = useRef<Partial<Record<ToyKind, HTMLElement | null>>>({});
  const bottomRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLDivElement>(null);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const later = useCallback((ms: number, fn: () => void) => {
    const t = setTimeout(() => { timers.current.delete(t); fn(); }, ms);
    timers.current.add(t);
  }, []);

  const bd = useMemo(() => (view ? backdrop(view.look) : null), [view?.look]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------- care: optimistic, batched, eased to the server ---------- */

  const onCare = useCallback((u: CareUpdate) => {
    if (!valid()) return;
    const wasAsleep = careRef.current?.asleep;
    careRef.current = u.care;
    setNeeds(needsOf(u.care));
    const m = moodOf(u.care);
    if (!sameMood(moodRef.current, m)) {
      moodRef.current = m;
      setMood(m);
      engineRef.current?.setMood(m);
    }
    // awake again: what was saved for the pet awake plays now, after the wake has read
    if (wasAsleep && !u.care.asleep && afterWake.current.length) {
      const queue = afterWake.current.splice(0);
      let at = 1600;
      for (const fn of queue) { later(at, fn); at += 1500; }
    }
    const e = engineRef.current;
    e?.setBond(u.care.bond);
    if (u.source === 'local' && u.action) localGuard.current[u.action] = u.guard;
    // the optimistic guess was wrong: the server's guard plays its cute reaction (never a block)
    if (u.source === 'server' && e && u.action && u.guard && localGuard.current[u.action] !== u.guard) {
      if (u.guard === 'full' && u.action === 'feed') e.fire({ type: 'tooFull' });
      if (u.guard === 'tired' && u.action === 'play') e.fire({ type: 'refuse', why: 'tired' });
    }
    if (u.bondMilestone !== undefined) whenAwake(() => engineRef.current?.fire({ type: 'celebrate', why: 'bond' }));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /** Celebrations are for a pet that is awake: while it sleeps they wait for the wake. */
  function whenAwake(fn: () => void) {
    if (careRef.current?.asleep) afterWake.current.push(fn);
    else fn();
  }
  const sync = useMemo(() => new CareSync({ api, agentId, onCare }), [api, agentId, onCare]);
  useEffect(() => sync.attach(), [sync]);

  /* ---------- mount: fresh authenticated GET only ---------- */

  useLayoutEffect(() => {
    const pendingRequests = requests.current;
    alive.current = true;
    allowed.current = true;
    setMounted(true);
    setTier(initialTier());
    bootTelegram(PET_GROUND);
    void load();
    return () => {
      alive.current = false;
      clearPrivate();
      for (const ac of pendingRequests) ac.abort();
      pendingRequests.clear();
    };
    // Each mount/re-attachment needs its own verified response; old requests are aborted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId]);
  // the OS reduced-motion switch flips the tier live (a ?tier= override stays put)
  useEffect(() => {
    if (new URLSearchParams(location.search).has('tier')) return;
    let mq: MediaQueryList;
    try { mq = window.matchMedia(REDUCED_MOTION_QUERY); } catch { return; }
    const on = () => setTier(detectTier(mq.matches));
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  useEffect(() => () => { for (const t of timers.current) clearTimeout(t); }, []);

  function clearPrivate() {
    allowed.current = false;
    sync.dispose();
    for (const ac of requests.current) ac.abort();
    requests.current.clear();
    speakToken.current++;
    stopAudio();
    stopWaiting();
    recHold.current?.(); recHold.current = null;
    const ctx = audioCtx.current;
    if (ctx) void ctx.close?.().catch(() => {});
    for (const t of timers.current) clearTimeout(t);
    timers.current.clear();
    queued.current = []; afterWake.current = [];
    viewRef.current = null; careRef.current = null; moodRef.current = null;
    engineRef.current?.stop();
    setView(null); setNeeds(null); setMood(null); setBubble(null); setThought(null); setScore(null); setDays(null);
    talkRef.current = 'idle'; setTalk('idle');
  }

  denyRef.current = (e) => {
    clearPrivate();
    const b = isPetError(e) && e.code === 'pet_private' && e.body && 'look' in e.body ? e.body : undefined;
    const kind = isPetError(e) && e.status === 401 ? 'outside' : b ? 'private'
      : isPetError(e) && e.status === 403 && e.code === 'conversation_failed' && e.message === 'conversation_not_permitted' ? 'chat-access'
      : isPetError(e) && e.status === 404 && e.code === 'pet_unavailable' ? 'resting' : 'unavailable';
    setFatal({ kind, look: b?.look, stage: b?.stage, name: b?.name });
  };

  function adoptView(v: PetView) {
    if (!valid()) return;
    const prev = viewRef.current;
    viewRef.current = v;
    setView(v);
    if (!prev || prev.stage !== v.stage) setStage(v.stageUp ? v.stageUp.from : v.stage);
    sync.adopt(v.care, v.now);
    paintChrome(backdrop(v.look).edge);
    engineRef.current?.setLook(v.look, v.stageUp ? v.stageUp.from : v.stage);
  }

  async function load() {
    try {
      const v = await api.get(agentId);
      if (!valid()) return;
      adoptView(v);
      setFatal(null);
      afterHello(900, () => playOpenEvents(v));
    } catch (e) {
      if (!valid()) return;
      if (isPetError(e) && (e.status === 401 || e.status === 403 || e.code === 'pet_unavailable')) { denyRef.current(e); return; }
      setFatal({ kind: 'offline' });
    }
  }

  /** Run after the hello has had `ms` to read (or right away if it played long ago). */
  function afterHello(ms: number, fn: () => void) {
    if (helloAt.current === null) { queued.current.push(fn); return; }
    later(Math.max(0, helloAt.current + ms - performance.now()), fn);
  }

  /** Welcome-back, stage-up and a Bond milestone, once each, one after another; asleep (quiet hours), at the wake. */
  function playOpenEvents(v: PetView) {
    const e = engineRef.current;
    if (!e) return;
    const steps: Array<[number, () => void]> = [];
    if (v.welcome) { const souvenir = v.welcome.souvenir; steps.push([1400, () => e.fire({ type: 'welcomeBack', souvenir })]); }
    if (v.stageUp) {
      const { from, to } = v.stageUp;
      steps.push([1600, () => { setStage(to); e.setLook(v.look, to); e.fire({ type: 'stageUp', from, to }); }]);
    }
    if (v.bondMilestone !== undefined) steps.push([0, () => e.fire({ type: 'celebrate', why: 'bond' })]);
    if (!steps.length) return;
    const run = () => { let at = 0; for (const [ms, fn] of steps) { later(at, fn); at += ms; } };
    whenAwake(run);
  }

  /* ---------- the engine: created once the look is known ---------- */

  const hasView = !!view;
  useLayoutEffect(() => {
    const v = viewRef.current;
    if (!v || !mounted) return;
    const care = careRef.current ?? v.care;
    const m = moodOf(care);
    moodRef.current = m;
    setMood(m);
    const e = createPetEngine({
      look: v.look, stage: v.stageUp ? v.stageUp.from : v.stage, size: box.size, tier, mood: m,
      seed: (Date.now() ^ v.care.userId) >>> 0, onCue: (c: EngineCue) => cueRef.current(c),
    });
    e.setBond(care.bond);
    setEngine(e);
    return () => { e.dispose(); setEngine(null); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasView, mounted]);
  useEffect(() => { engine?.setTier(tier); }, [engine, tier]);

  // ready() once the character is painted, then hello (or the asleep loop in quiet hours)
  useEffect(() => {
    if (!engine) return;
    engine.start();
    return readyAfterPaint(tg(), () => {
      helloAt.current = performance.now();
      const care = careRef.current;
      if (!care?.asleep && !conversationStarted.current) engine.fire({ type: 'hello', firstName: firstName() });
      if (care) {
        setDays(daysTogether(care.firstMetAt, sync.now()));
      }
      for (const fn of queued.current.splice(0)) afterHello(900, fn);
      const intent = startIntent();
      if (intent) later(1300, () => intent === 'talk' ? setFocusTalk(true) : onToy(intent === 'feed' ? { type: 'cookieTap' } : { type: 'ballTap' }));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine]);


  /* ---------- layout ---------- */

  const measure = useCallback(() => {
    const w = window.innerWidth, h = cssPx('--pet-vh') || window.innerHeight;
    const top = cssPx('--pet-safe-top');
    setSafeTop((p) => (p === top ? p : top));
    const dockTop = bottomRef.current?.getBoundingClientRect().top ?? h - 180;
    const b = characterBox(w, h, top, dockTop);
    setBox((p) => (p.x === b.x && p.y === b.y && p.size === b.size ? p : b));
    const e = engineRef.current;
    if (!e) return;
    e.setSize(b.size);
    const rect = (k: ToyKind) => toyEls.current[k]?.getBoundingClientRect();
    e.setScene(sceneAnchors(w, h, b, { cookie: rect('cookie'), ball: rect('ball'), moon: rect('moon') }, pillRef.current?.getBoundingClientRect() ?? null));
  }, []);

  // The safe-area vars first, then the measure, on every Telegram event that moves them (a fullscreen's
  // content safe area can arrive after its viewportChanged): the character never keeps a stale top.
  useLayoutEffect(() => {
    if (!mounted) return;
    const app = tg();
    const offVars = syncSafeAreas(app);
    measure();
    window.addEventListener('resize', measure);
    for (const ev of LAYOUT_EVENTS) app?.onEvent?.(ev, measure);
    return () => {
      offVars();
      window.removeEventListener('resize', measure);
      for (const ev of LAYOUT_EVENTS) app?.offEvent?.(ev, measure);
    };
  }, [mounted, engine, measure]);

  /* ---------- page activity, first touch (audio, shake) ---------- */

  useEffect(() => {
    if (!engine) return;
    let stopAccel: (() => void) | null = null;
    let touched = false;

    const first = () => {
      const ctx = audio();
      if (ctx?.state === 'suspended') void ctx.resume();
      if (!touched) { touched = true; stopAccel = startAccelerometer((a) => engine.accel(a)); }
    };
    document.addEventListener('pointerdown', first, { capture: true });
    const paused = (on: boolean) => rootRef.current?.toggleAttribute('data-paused', on);
    paused(!pageActive());
    const unsub = subscribeActivity(() => {
      if (pageActive()) {
        paused(false);
        engine.start();
        if (touched && !stopAccel) stopAccel = startAccelerometer((a) => engine.accel(a));
      } else {
        paused(true);
        engine.stop();
        stopAccel?.(); stopAccel = null;
        // The session boundary discards private state on hide; foreground starts a fresh GET.
        stopAudio();

      }
    });
    return () => { document.removeEventListener('pointerdown', first, { capture: true }); unsub(); stopAccel?.(); };
  }, [engine, audio, sync, agentId]);

  // ⋯ → Settings opens the person's own data (export, erase, notes) in Vox: VoxxBot signs that page, never this agent's bot.
  const dataUrl = view?.dataUrl;
  useEffect(() => {
    if (!dataUrl?.startsWith('https://t.me/')) return;
    return settingsButton(() => { if (valid()) openTelegram(dataUrl); });
  }, [dataUrl, valid]);

  /* ---------- engine cues ---------- */

  const finishSpeaking = useCallback((token: number) => {
    if (token !== speakToken.current || talkRef.current !== 'speaking') return;
    const e = engineRef.current;
    talkRef.current = 'idle';
    setTalk('idle');
    e?.talk('idle');
    const bye = goodbye.current;
    if (bye) { goodbye.current = false; e?.fire({ type: 'wave' }); }
    // the reply crossed a Bond milestone (talk is where most are reached): the heart burst once it is said
    if (milestone.current) { milestone.current = false; later(bye ? 1300 : 250, () => whenAwake(() => engineRef.current?.fire({ type: 'celebrate', why: 'bond' }))); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const cueRef = useRef<(c: EngineCue) => void>(() => {});
  cueRef.current = (c: EngineCue) => {
    if (!valid()) return;
    switch (c.type) {
      case 'expr': setExpr(c.expr); break;
      case 'say':
        // Ambient reactions cannot replace the person's current conversation or a late greeting.
        if (talkRef.current === 'idle' && !(conversationStarted.current && c.line === 'hi'))
          setBubble({ id: performance.now(), text: sayText(c.line, firstName()) });
        break;
      case 'thought': { const need = c.need; setThought(need); later(2400, () => setThought((n) => (n === need ? null : n))); break; }
      case 'care': sync.act(c.action, c.n); break;
      case 'score': setScore({ bops: c.bops, misses: c.misses }); break;
      case 'playOver': later(1200, () => setScore(null)); break;
      case 'spoken': finishSpeaking(speakToken.current); break;
    }
  };

  /* ---------- toys ---------- */

  const onToy = useCallback((t: ToyEvent) => {
    const e = engineRef.current, care = careRef.current;
    if (!e || !valid()) return;
    const full = !!care && care.tummy >= FULL_AT;
    if (full && t.type === 'cookieTap') { e.fire({ type: 'tooFull' }); return; }
    if (full && t.type === 'cookieDrop') {
      // dropped back home (not on the mouth), then the belly pat and head shake
      const home = toyEls.current.cookie?.getBoundingClientRect();
      e.toy({ type: 'cookieDrop', at: home ? { x: home.left + home.width / 2, y: home.top + home.height / 2 } : t.at });
      e.fire({ type: 'tooFull' });
      return;
    }
    // too tired is the care rule (Energy < TIRED_BELOW), the same one the server applies to the play
    if (t.type === 'ballTap' && !t.at) { e.toy({ ...t, tired: !!care && care.energy < TIRED_BELOW }); return; }
    e.toy(t);
  }, [valid]);
  const toyRef = useCallback((k: ToyKind, el: HTMLElement | null) => { toyEls.current[k] = el; }, []);

  /* ---------- talk ---------- */

  const setTalkState = (s: TalkState) => { talkRef.current = s; setTalk(s); engineRef.current?.talk(s); };

  const onListen = useCallback((source: 'text' | 'mic') => {
    const e = engineRef.current;
    if (!valid() || !e || talkRef.current === 'thinking' || talkRef.current === 'speaking') return;
    conversationStarted.current = true;
    talkRef.current = 'listening';
    // the engine plays the perk on entering listening (once; the mic gets its own variant)
    e.talk('listening', source);
    setTalk('listening');
  }, [valid]);
  const onIdle = useCallback(() => {
    if (talkRef.current !== 'listening') return;
    setTalkState('idle');
  }, []);
  const onTypingPause = useCallback(() => { if (talkRef.current === 'listening') engineRef.current?.fire({ type: 'typingPause' }); }, []);

  /** Stop the reply audio now playing (a new turn, a new reply): its lip-sync ends with it. */
  function stopAudio() {
    const src = source.current;
    if (!src) return;
    source.current = null;
    src.onended = null;
    try { src.stop(); } catch { /* already ended */ }
    try { src.disconnect(); } catch { /* already disconnected */ }
    engineRef.current?.stopSpeaking();
  }

  function startThinking() {
    stopAudio();
    // entering thinking plays the acknowledge nod in the engine
    setTalkState('thinking');
    hideKeyboard();
    closing.current?.();
    closing.current = holdClosing();
  }

  function stopWaiting() { closing.current?.(); closing.current = null; }

  function speak(reply: string, care?: PetCare, isGoodbye?: boolean, audioB64?: string, bondMilestone?: number) {
    if (!valid()) return;
    const e = engineRef.current;
    stopWaiting();
    stopAudio();
    if (care) sync.adopt(care);
    goodbye.current = !!isGoodbye;
    milestone.current = bondMilestone !== undefined;
    const token = ++speakToken.current;
    setBubble({ id: performance.now(), text: reply });
    setTalkState('speaking');
    // a safety net for text: never leave the mouth "speaking" if a spoken cue goes missing
    const speakText = () => { if (!valid() || token !== speakToken.current) return; e?.speakText(reply, REVEAL_CPS); later((reply.length / REVEAL_CPS) * 1000 + 1500, () => finishSpeaking(token)); };
    if (audioB64 && e) void playAudio(audioB64, token).catch(speakText);
    else speakText();
  }

  async function playAudio(b64: string, token: number) {
    const ctx = audio(), e = engineRef.current;
    if (!ctx || !e) throw new Error('no audio');
    const bytes = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
    const buf = await ctx.decodeAudioData(bytes.buffer as ArrayBuffer);
    const src = ctx.createBufferSource();
    const an = ctx.createAnalyser();
    an.fftSize = 1024;
    src.buffer = buf;
    src.connect(an);
    an.connect(ctx.destination);
    // a newer turn may have started while this decoded
    if (!valid() || token !== speakToken.current) return;
    stopAudio();
    source.current = src;
    // only this reply's end may close this reply's mouth (a newer one owns the lip-sync by then)
    src.onended = () => {
      if (source.current === src) source.current = null;
      if (!valid() || token !== speakToken.current) return;
      e.stopSpeaking();
      finishSpeaking(token);
    };
    e.speakAudio(an);
    src.start();
  }

  function talkFailed(err: unknown) {
    if (!valid()) return;
    stopWaiting();
    const v = viewRef.current;
    if (isPetError(err) && err.code === 'guest_talk' && v) { setTalkState('idle'); openDm(v.botUsername); return; }
    setTalkState('idle');
    // the server cannot hear (no transcription provider): say so, the text field is right there
    const text = isPetError(err) && err.code === 'session_expired' ? (/^fa\b/i.test(tg()?.initDataUnsafe?.user?.language_code ?? '') ? COPY.reopenFa : COPY.reopen)
      : isPetError(err) && err.message === 'voice_unavailable' ? COPY.micBlocked : COPY.talkFailed;
    setBubble({ id: performance.now(), text });
  }

  /** A talk call that gives up after TALK_TIMEOUT_MS (a stalled mobile request fails like any other). */
  async function withTimeout<T>(run: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), TALK_TIMEOUT_MS);
    try { return await run(ac.signal); } finally { clearTimeout(t); }
  }

  /** Resolves false when the turn failed, so the pill puts the words back. */
  const onSend = async (text: string): Promise<boolean> => {
    if (!valid()) return false;
    conversationStarted.current = true;
    startThinking();
    try {
      const r = await withTimeout((signal) => api.talk(agentId, { text }, { signal }));
      if (!valid()) return false;
      speak(r.reply, r.care, r.goodbye, undefined, r.bondMilestone);
      return true;
    } catch (err) { talkFailed(err); return false; }
  };

  const onVoice = async (blob: Blob) => {
    if (!valid()) return false;
    conversationStarted.current = true;
    startThinking();
    try {
      const r = await withTimeout((signal) => api.talkVoice(agentId, blob, { signal }));
      if (!valid()) return;
      // nothing heard (silence, noise): a gentle "try again", never an empty bubble
      if (!r.transcript || !r.reply) {
        stopWaiting();
        setTalkState('idle');
        setBubble({ id: performance.now(), text: COPY.didntCatch });
        return;
      }
      speak(r.reply, r.care, r.goodbye, r.audio, r.bondMilestone);
    } catch (err) { talkFailed(err); }
  };

  const recHold = useRef<(() => void) | null>(null);
  const onRecording = useCallback((on: boolean) => {
    recHold.current?.();
    recHold.current = on ? holdClosing() : null;
  }, []);
  const onMicLevel = useCallback((l: number) => engineRef.current?.micLevel(l), []);
  const onOpenDm = useCallback(() => { const v = viewRef.current; if (v) openDm(v.botUsername); }, []);

  /* ---------- render ---------- */

  if (fatal) {
    return (
      <Suspense fallback={<main className="pet-root" data-pet-root="" style={{ backgroundColor: bd?.edge ?? PET_GROUND }} />}>
        <Sleeper kind={fatal.kind} look={fatal.look} stage={fatal.stage} name={fatal.name} onRetry={fatal.kind === 'offline' || fatal.kind === 'unavailable' ? onRetry : undefined} />
      </Suspense>
    );
  }
  if (!mounted || !view || !bd || !engine) return <main className="pet-root" data-pet-root="" style={{ backgroundColor: bd?.edge ?? PET_GROUND }} />;

  const headTop = box.y + box.size * 0.2;
  // m.* elements with the minimal feature set: the rig only binds MotionValues (no layout, drag or gestures)
  return (
    <LazyMotion features={domMin}>
    <main ref={rootRef} className="pet-root" data-pet-root="" data-tier={tier} data-stage={stage} data-tone={mood?.tone} data-asleep={mood?.asleep ? '' : undefined} data-talk={talk}>
      <Stage engine={engine} backdrop={bd} box={box}
        over={<>
          <Particles engine={engine} />
          <Thought need={thought} top={box.y + box.size * 0.02} left={box.x + box.size * 0.82} />
          <Bubble msg={bubble} top={headTop} room={headTop - safeTop} onGone={(id) => setBubble((b) => (b?.id === id ? null : b))} />
          {days !== null && <div className="pet-days" style={{ top: box.y + box.size * 0.9 }} onAnimationEnd={() => setDays(null)}>{COPY.daysTogether(days)}</div>}
          {score && <div className="pet-score" aria-live="polite">{COPY.score(score.bops)}</div>}
        </>}>
        <PetRig engine={engine} look={view.look} stage={stage} size={box.size} label={view.name} expr={expr} />
      </Stage>
      <div className="pet-bottom" ref={bottomRef}>
        <Dock needs={needs} onToy={onToy} toyRef={toyRef} />
        <div ref={pillRef}>
          <TalkPill name={view.name} guest={view.role === 'guest' || !!view.talkInDm} onOpenDm={onOpenDm} busy={talk === 'thinking'}
            onListen={onListen} onIdle={onIdle} onTypingPause={onTypingPause} onSend={onSend}
            onVoice={view.listen !== false ? (b) => void onVoice(b) : undefined} onMicLevel={onMicLevel} onRecording={onRecording} audioContext={audio} autoFocus={focusTalk} />
        </div>
      </div>
      {code && api.send && <Suspense fallback={null}><Circle api={api} agentId={agentId} code={code} onJoy={(why) => whenAwake(() => engineRef.current?.fire({ type: 'celebrate', why }))} /></Suspense>}
    </main>
    </LazyMotion>
  );
}
