'use client';

import { domMin, LazyMotion } from 'framer-motion';
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Expression } from '@/lib/studio/character';
import { FULL_AT, TIRED_BELOW, type Mood, type NeedKey, type PetCare, type PetView, type Stage as StageN } from '@/lib/pet/types';
import { detectTier } from '../../_lib/motion';
import { pageActive, REDUCED_MOTION_QUERY, subscribeActivity } from '../../_components/motion/activity';
import { createPetEngine } from '../_engine/loop';
import type { Tier } from '../_engine/types';
import { createPetApi, isPetError } from './api';
import { moodOf, openLocal } from './care-local';
import { CareSync, type CareUpdate } from './careSync';
import { SNAPSHOT_KEY, type EngineCue, type PetApi, type PetEngine, type PetSnapshot, type TalkState, type ToyEvent, type ToyKind } from './contract';
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
  bootTelegram, closeApp, confirmNative, firstName, hideKeyboard, holdClosing, LAYOUT_EVENTS, openDm, paintChrome, readStored, readStoredSync,
  readyAfterPaint, settingsButton, startAccelerometer, startIntent, syncSafeAreas, tg, writeStored,
} from './telegram';

/* ---------- snapshot (instant first paint) ---------- */

function parseSnapshot(raw: string | null): PetView | null {
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as PetSnapshot;
    return s?.v === 1 && s.view?.look && s.view.care ? s.view : null;
  } catch { return null; }
}

function saveSnapshot(agentId: string, view: PetView, care?: PetCare | null) {
  // one-shot open events never replay from the cache
  const cached: PetView = { ...view, ...(care ? { care } : {}) };
  delete cached.welcome; delete cached.stageUp; delete cached.bondMilestone;
  const snap: PetSnapshot = { v: 1, view: cached, savedAt: Date.now() };
  writeStored(SNAPSHOT_KEY(agentId), JSON.stringify(snap));
}

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
/** A reply's audio that cannot resume after the page comes back (no gesture yet) ends as text instead. */
const AUDIO_RESUME_MS = 800;

interface Fatal { kind: SleeperKind; look?: PetView['look']; stage?: StageN; name?: string }

/**
 * The pet page (brief §1.1): the character alive on a hue backdrop, three toys in need rings and a
 * talk pill, nothing else. Open sequence: paint from the cached snapshot → ready() → hello, then the
 * server view reconciles (mood eases, never snaps) and plays welcome-back / stage-up / a Bond
 * milestone once. React renders only on rare changes (layout, expression, bubble, rings); every
 * frame belongs to the engine.
 */
export function PetApp({ agentId, api: injected }: { agentId: string; api?: PetApi }) {
  const api = useMemo(() => injected ?? createPetApi(), [injected]);
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

  const viewRef = useRef<PetView | null>(null);
  viewRef.current = view;
  const engineRef = useRef<PetEngine | null>(null);
  engineRef.current = engine;
  const moodRef = useRef<Mood | null>(null);
  const careRef = useRef<PetCare | null>(null);
  const talkRef = useRef<TalkState>('idle');
  const helloAt = useRef<number | null>(null);
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
  /** the person asked to forget their pet: nothing may write it back (no snapshot, no tap flush) */
  const forgotten = useRef(false);
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

  /* ---------- mount: tier, Telegram boot, snapshot ---------- */

  const booted = useRef<string | null>(null);
  useLayoutEffect(() => {
    // once per agent (StrictMode replays effects; GET is the "open" event and must not run twice)
    if (booted.current === agentId) return;
    booted.current = agentId;
    setMounted(true);
    setTier(initialTier());
    const snap = parseSnapshot(readStoredSync(SNAPSHOT_KEY(agentId)));
    bootTelegram(snap ? backdrop(snap.look).edge : PET_GROUND);
    if (snap) adoptView(snap, false);
    else void readStored(SNAPSHOT_KEY(agentId)).then((raw) => { const s = parseSnapshot(raw); if (s && !viewRef.current) adoptView(s, false); });
    void load();
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

  function adoptView(v: PetView, fromServer: boolean) {
    const prev = viewRef.current;
    viewRef.current = v;
    setView(v);
    // a stage-up keeps drawing the old stage until its celebration morphs it
    if (!prev || prev.stage !== v.stage) setStage(v.stageUp ? v.stageUp.from : v.stage);
    // The cached snapshot is opened the way the server will open it (decay, then the welcome-back floors
    // and quiet-hours sleep): days away paint a pet ready to celebrate, never the floors (§1.6).
    if (fromServer) sync.adopt(v.care, v.now);
    else sync.adopt(openLocal(v.care, sync.now(), v.stage).care);
    if (fromServer) {
      paintChrome(backdrop(v.look).edge);
      saveSnapshot(agentId, v);
      engineRef.current?.setLook(v.look, v.stageUp ? v.stageUp.from : v.stage);
    }
  }

  async function load() {
    try {
      const v = await api.get(agentId);
      adoptView(v, true);
      setFatal(null);
      afterHello(900, () => playOpenEvents(v));
    } catch (e) {
      const has = !!viewRef.current;
      if (isPetError(e)) {
        if (e.code === 'pet_private') {
          const b = e.body && 'look' in e.body ? e.body : undefined;
          setFatal({ kind: 'private', look: b?.look, stage: b?.stage, name: b?.name });
          return;
        }
        if (e.code === 'authentication_required') { setFatal({ kind: 'outside' }); return; }
        if (e.code === 'pet_unavailable') { setFatal({ kind: 'resting' }); return; }
      }
      // offline with a cached character: keep it alive and quiet; without one, the retry screen
      if (!has) setFatal({ kind: 'offline' });
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
      if (!care?.asleep) engine.fire({ type: 'hello', firstName: firstName() });
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
    /** the reply audio was playing when the page went away: it resumes with the page */
    let resumeAudio = false;
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
        const ctx = audioCtx.current;
        if (resumeAudio && ctx) {
          resumeAudio = false;
          void ctx.resume().catch(() => {});
          // still suspended (no gesture since): the rest of the reply is text, never a stuck "speaking"
          later(AUDIO_RESUME_MS, () => { if (ctx.state !== 'running' && source.current) { const token = speakToken.current; stopAudio(); finishSpeaking(token); } });
        }
      } else {
        paused(true);
        engine.stop();
        stopAccel?.(); stopAccel = null;
        // only a context a gesture made, and only if it is running (never a new one outside a gesture)
        const ctx = audioCtx.current;
        if (ctx?.state === 'running') { resumeAudio = !!source.current; void ctx.suspend().catch(() => {}); }
        void sync.flush({ keepalive: true });
        const v = viewRef.current;
        if (v && !forgotten.current) saveSnapshot(agentId, v, sync.current);
      }
    });
    return () => { document.removeEventListener('pointerdown', first, { capture: true }); unsub(); stopAccel?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, audio, sync, agentId]);

  // Telegram's ⋯ menu → Settings: forget my pet (the page's self-service rights path; guests have no other).
  useEffect(() => {
    if (!view) return;
    const name = view.name;
    return settingsButton(() => {
      void confirmNative(COPY.forgetAsk(name)).then(async (ok) => {
        if (!ok) return;
        // stop every write first (waiting taps, answers, the snapshot), so nothing recreates what is erased
        forgotten.current = true;
        sync.dispose();
        try { await api.forget(agentId); } catch {
          forgotten.current = false;
          sync.attach();
          setBubble({ id: performance.now(), text: COPY.talkFailed });
          return;
        }
        try { localStorage.removeItem(SNAPSHOT_KEY(agentId)); } catch { /* private mode */ }
        writeStored(SNAPSHOT_KEY(agentId), '');
        closeApp();
      });
    });
  }, [!!view, api, agentId]); // eslint-disable-line react-hooks/exhaustive-deps

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
    switch (c.type) {
      case 'expr': setExpr(c.expr); break;
      case 'say': setBubble({ id: performance.now(), text: sayText(c.line, firstName()) }); break;
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
    if (!e) return;
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
  }, []);
  const toyRef = useCallback((k: ToyKind, el: HTMLElement | null) => { toyEls.current[k] = el; }, []);

  /* ---------- talk ---------- */

  const setTalkState = (s: TalkState) => { talkRef.current = s; setTalk(s); engineRef.current?.talk(s); };

  const onListen = useCallback((source: 'text' | 'mic') => {
    const e = engineRef.current;
    if (!e || talkRef.current === 'thinking' || talkRef.current === 'speaking') return;
    talkRef.current = 'listening';
    // the engine plays the perk on entering listening (once; the mic gets its own variant)
    e.talk('listening', source);
    setTalk('listening');
  }, []);
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
    const speakText = () => { e?.speakText(reply, REVEAL_CPS); later((reply.length / REVEAL_CPS) * 1000 + 1500, () => finishSpeaking(token)); };
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
    if (token !== speakToken.current) return;
    stopAudio();
    source.current = src;
    // only this reply's end may close this reply's mouth (a newer one owns the lip-sync by then)
    src.onended = () => {
      if (source.current === src) source.current = null;
      if (token !== speakToken.current) return;
      e.stopSpeaking();
      finishSpeaking(token);
    };
    e.speakAudio(an);
    src.start();
  }

  function talkFailed(err: unknown) {
    stopWaiting();
    const v = viewRef.current;
    if (isPetError(err) && err.code === 'guest_talk' && v) { setTalkState('idle'); openDm(v.botUsername); return; }
    setTalkState('idle');
    // the server cannot hear (no transcription provider): say so, the text field is right there
    const text = isPetError(err) && err.message === 'voice_unavailable' ? COPY.micBlocked : COPY.talkFailed;
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
    startThinking();
    try {
      const r = await withTimeout((signal) => api.talk(agentId, { text }, { signal }));
      speak(r.reply, r.care, r.goodbye, undefined, r.bondMilestone);
      return true;
    } catch (err) { talkFailed(err); return false; }
  };

  const onVoice = async (blob: Blob) => {
    startThinking();
    try {
      const r = await withTimeout((signal) => api.talkVoice(agentId, blob, { signal }));
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
        <Sleeper kind={fatal.kind} look={fatal.look ?? view?.look} stage={fatal.stage ?? view?.stage} name={fatal.name ?? view?.name} onRetry={fatal.kind === 'offline' ? () => { setFatal(null); void load(); } : undefined} />
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
          <TalkPill name={view.name} guest={view.role === 'guest'} onOpenDm={onOpenDm} busy={talk === 'thinking'}
            onListen={onListen} onIdle={onIdle} onTypingPause={onTypingPause} onSend={onSend}
            onVoice={view.listen !== false ? (b) => void onVoice(b) : undefined} onMicLevel={onMicLevel} onRecording={onRecording} audioContext={audio} autoFocus={focusTalk} />
        </div>
      </div>
    </main>
    </LazyMotion>
  );
}
