'use client';

import { flushSync } from 'react-dom';
import { domMin, LazyMotion, type MotionValue } from 'framer-motion';
import { lazy, Suspense, useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Expression } from '@/lib/studio/character';
import { FULL_AT, TIRED_BELOW, type Mood, type NeedKey, type PetCare, type PetView, type Stage as StageN, type TalkVoiceResponse } from '@/lib/pet/types';
import { detectTier } from '../../_lib/motion';
import { pageActive, REDUCED_MOTION_QUERY, subscribeActivity } from '../../_components/motion/activity';
import { createPetEngine } from '../_engine/loop';
import type { Tier } from '../_engine/types';
import { createPetApi, isPetError } from './api';
import { moodOf } from './care-local';
import { CareSync, type CareUpdate } from './careSync';
import {
  type EngineCue, type PetApi, type PetEngine, type PetRequestOpts, type PetViewB, type PlayRequest, type PlayResponse, type TalkReplyB, type TalkState, type ToyEvent, type ToyKind,
} from './contract';
import type { HostSignal, PetHost, VoiceUi } from './host';
import type { SentenceQueue } from './voiceStream';
import { daysTogetherText, sayText } from './copy';
import { Bubble, REVEAL_CPS, Thought, type BubbleMsg } from './Bubble';
import { Dock, type Needs } from './Dock';
import { BUBBLE_LINES, bubbleWidth, COLUMN_MAX, KEYBOARD_PX, layoutOf, type Layout } from './layout';
import { Particles } from './Particles';
import { PetRig } from './PetRig';
import type { SleeperKind } from './Sleeper';
import { Stage } from './Stage';
import { TalkPill } from './TalkPill';
import { ROOM_IDS, ROOM_VIEW, stepToward, type RoomId } from './rooms';
import { ROOM_PANEL_ID, RoomRail, roomTabId } from './rooms/RoomRail';
import { backdrop, characterBox, daysTogether, groundPoint, PET_GROUND, sceneAnchors, type AwayBackdrop, type CharacterBox } from './scene';
import { cleanFirst, dir, petLang, t, useStrings, type PetStringKey } from './strings';
import { BEDTIME_MS, BUSY, openOver, TIP_OPEN_MS } from './tipOpen';
import {
  bootTelegram, circleCode, closeApp, firstName, hideKeyboard, holdClosing, LAYOUT_EVENTS, openDm, openTelegram, paintChrome, clearLegacyPetSnapshots,
  readyAfterPaint, settingsButton, startAccelerometer, startIntent, syncSafeAreas, tg, viewport,
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

/** The quiet screens load (with their CSS) only when one shows: the living page never carries them. */
const Sleeper = lazy(() => import('./Sleeper').then((m) => ({ default: m.Sleeper })));
/** Circles S4: the group halo and sheets, with their CSS, only for a page opened with a group code. */
const Circle = lazy(() => import('./Circle').then((m) => ({ default: m.Circle })));
/** Wave B's living-page layer (tips, sheets, growth, hands-free), after hello: never on the first paint. */
const Extras = lazy(() => import('./Extras'));
/** Lit growth details on the character (eye glints, pins, charms, floor keepsakes), with the Wave B layer. */
const Details = lazy(() => import('./Details'));

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

/**
 * The person asked to keep something ("remember this" / «یادت باشه»): no reply field says a note was saved yet, so the
 * growth confirm step (§4.11) follows the person's own words, after a reply that succeeded.
 */
const REMEMBER = /\bremember (this|that)\b|یادت باشه|یادت بمونه/i;

/** Where each PetApi method takes its options (the session wraps them all alike). */
const OPTS_AT = { get: 1, care: 2, talk: 2, talkVoice: 2, play: 2, growthConfirm: 2, checkins: 2, look: 2, talkVoiceStream: 3, send: 4 } as const;

/** A talk turn that hears nothing back in this long fails like any other (the pet never thinks forever). */
const TALK_TIMEOUT_MS = 45_000;

/**
 * The hello (S2): "Hi Sara!", by the person's local hour (morning, midday, afternoon, the moon's out; never «شب بخیر»,
 * which is a goodbye). Late at night it is the plain hello.
 */
export function helloText(name: string | undefined, hour = new Date().getHours()): string {
  const part = hour >= 5 && hour < 11 ? 'morning' : hour >= 11 && hour < 15 ? 'noon' : hour >= 15 && hour < 19 ? 'afternoon' : hour >= 19 && hour < 22 ? 'evening' : '';
  const first = cleanFirst(name);
  if (!part) return first ? t('say.hiName', { first }) : t('say.hi');
  return t(`say.hi.${part}${first ? '.name' : ''}` as PetStringKey, first ? { first } : undefined);
}

/** The stage-up line (growth §4.11): what it has learned so far when a moment is lit, else that it is getting ready. */
const stageLine = (v: PetViewB | null) => t(v?.growth?.moments.some((m) => m.lit || v.growth?.mine?.includes(m.id)) ? 'growth.stage.learned' : 'growth.stage.ready');

/** The welcome-back line (P-21): the pet's own small news, in the person's language; never the server's free text. */
const welcomeLine = (now = Date.now()) => t(`say.welcomeBack.${1 + (Math.floor(now / 86_400_000) % 5)}` as PetStringKey);

/** A check-in replay's line holds the bubble this long before a first room visit may light its own moment. */
const REPLAY_HOLD_MS = 6000;

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
  const lang = petLang();
  // re-render once the language's words are in (the Close button's own label)
  useStrings(lang);
  return <>
    {(!scope.active || !current) ? <main className="pet-root" data-pet-root="" data-paused="" style={{ backgroundColor: PET_GROUND }} /> :
    <PetSession key={`${agentId}:${scope.generation}`} agentId={agentId} injected={api} signed={scope.signed}
    onRetry={() => {
      // A retry starts with a fresh authenticated GET and fresh request/care/audio state.
      // Never retry across an account/foreground change.
      if (!pageActive() || scopeRef.current.agentId !== agentId || scopeRef.current.signed !== (tg()?.initData ?? '')) return;
      setScope((s) => ({ ...s, generation: s.generation + 1 }));
    }} />}
    {telegramReady && app?.initData && app.close && <button type="button" className="pet-close" dir={dir(lang)} style={{ position: 'fixed', zIndex: 20,
      top: 'calc(var(--pet-safe-top,env(safe-area-inset-top,0px)) + 8px)', insetInlineEnd: 'max(12px,env(safe-area-inset-right,0px))' }}
      onClick={() => closeApp()}>{t('ui.close', undefined, lang)}</button>}
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
        // A circle_*, checkins_* or look_forbidden refusal is its sheet's to show, and an expired talk window the bubble's: none ends the pet.
        if (valid() && isPetError(e) && ((e.status === 401 && e.code !== 'session_expired') || (e.status === 403 && !/^(circle|checkins|look_)/.test(e.code)) || e.code === 'pet_unavailable')) denyRef.current(e);
        throw e;
      } finally { requests.current.delete(ac); o.signal?.removeEventListener('abort', abort); }
    };
    // every method takes its options last (OPTS_AT): the session's abort joins them, and its refusals end the pet
    const out: Record<string, unknown> = {};
    for (const [k, n] of Object.entries(OPTS_AT)) {
      const fn = baseApi[k as keyof PetApi] as ((...a: unknown[]) => Promise<unknown>) | undefined;
      if (fn) out[k] = (...a: unknown[]) => call((opts) => fn.apply(baseApi, [...Array.from({ length: n }, (_, i) => a[i]), opts]), a[n] as PetRequestOpts);
    }
    return out as unknown as PetApi;
    // Each mounted session owns these refs and its signed authority; never re-used after a switch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseApi, signed]);
  const { get: audio, ctx: audioCtx } = useAudio();
  const [mounted, setMounted] = useState(false);
  const [view, setView] = useState<PetViewB | null>(null);
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
  const [score, setScore] = useState<{ bops: number; misses: number; out?: boolean } | null>(null);
  const [days, setDays] = useState<number | null>(null);
  const [focusTalk, setFocusTalk] = useState(false);
  const [box, setBox] = useState<CharacterBox>({ x: 0, y: 0, size: 200 });
  const [safeTop, setSafeTop] = useState(0);
  const code = useMemo(circleCode, []);
  /* the person's language for this session (strings module): Persian sets dir="rtl" and mirrors the rail */
  const lang = useMemo(petLang, []);
  const rtl = lang === 'fa';
  const stringsOk = useStrings(lang);
  /* design §9: the layout class, the room, and Peek's talk button */
  const [layout, setLayout] = useState<Layout>(() => layoutOf(typeof window === 'undefined' ? 390 : window.innerWidth, typeof window === 'undefined' ? 700 : window.innerHeight));
  const [vw, setVw] = useState(390);
  const [room, setRoom] = useState<RoomId>('home');
  /** the room the dock slot shows: the old dock stays (dimmed) until the new room's chunk is ready, never an empty band (P-19) */
  const dockRoom = useDeferredValue(room);
  const [talkOpen, setTalkOpen] = useState(false);
  /* Wave B: the pill's voice extras, Extras mounted after hello */
  const [voice, setVoiceUi] = useState<VoiceUi>({ handsFree: false, open: false, hearing: false });
  const [extras, setExtras] = useState(false);
  /** the talk field has focus (the keyboard can only be up then) */
  const typing = useRef(false);
  /** the tallest available height seen at this width: the keyboard shows as a drop below it */
  const fullH = useRef({ w: 0, h: 0 });

  const viewRef = useRef<PetViewB | null>(null);
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
  /** the reply audio now playing (a new turn stops it), and a streamed reply's sentence queue */
  const source = useRef<AudioBufferSourceNode | null>(null);
  const queue = useRef<SentenceQueue | null>(null);
  /* Wave B host: the signal bus, the last activity, the busy keys, the mic sheet's answer (null: not asked yet) */
  const bus = useRef(new Set<(s: HostSignal) => void>());
  const emit = (sig: HostSignal) => { for (const f of bus.current) f(sig); };
  const active = useRef(0);
  /** `open`: the opening seconds are the hello's (tips.ts openOver): no tip or ask until it lets go */
  const busyKeys = useRef(new Set<string>([BUSY.open]));
  const opening = useRef({ hello: false, touched: false, at: 0 });
  const openCheck = () => {
    const o = opening.current;
    if (openOver({ hello: o.hello, touched: o.touched, sinceHelloMs: performance.now() - o.at })) busyKeys.current.delete(BUSY.open);
  };
  /** the hello has been said (or no hello is due: asleep, a check-in's replay, a conversation already started) */
  const helloSaid = () => {
    if (opening.current.hello) return;
    opening.current = { ...opening.current, hello: true, at: performance.now() };
    later(TIP_OPEN_MS, openCheck);
    openCheck();
  };
  const touchedOnce = () => { opening.current.touched = true; openCheck(); };
  /** the person started talking: the hello's moment has passed (a talk turn's pet_action is never held back) */
  const conversed = () => { helloSaid(); touchedOnce(); };
  /** a check-in replay's room change: its first-visit moment waits until the replay's line has been read */
  const replayUntil = useRef(0);
  /** bedtime cut the Bop round: its pips fade out at once */
  const scoreCut = useRef(false);
  const micOk = useRef<boolean | null>(null);
  const boxRef = useRef(box);
  boxRef.current = box;
  const roomRef = useRef<RoomId>('home');
  const bubbleRef = useRef(false);
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

  // each room has its own backdrop and light (P-04), its floor drawn from the character's ground line
  const groundY = Math.round(groundPoint(box).y);
  // the away rooms' light is its own chunk, fetched once the page has said hello (Home never waits on it)
  const [away, setAway] = useState<AwayBackdrop | undefined>(undefined);
  const bd = useMemo(() => (view ? backdrop(view.look, room, groundY, away) : null), [view?.look, room, groundY, away]); // eslint-disable-line react-hooks/exhaustive-deps
  const wantAway = extras || room !== 'home';
  useEffect(() => {
    if (!wantAway || away) return;
    void import('./roomLight').then((m) => { if (alive.current) setAway(() => m.awayBackdrop); }, () => { /* offline: the rooms keep Home's light */ });
  }, [wantAway, away]);
  // Telegram's header and bottom bar take the room's edge colour with it
  const edgeColor = bd?.edge;
  useEffect(() => { if (edgeColor && valid()) paintChrome(edgeColor); }, [edgeColor, valid]);

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
    bus.current.clear();
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

  function adoptView(v: PetViewB) {
    if (!valid()) return;
    const prev = viewRef.current;
    viewRef.current = v;
    setView(v);
    emit({ type: 'view' });
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
      // a check-in's replay shows the floor (the C5 bloom's pot) from its first beat: fetch the overlay now (P-07)
      if (v.checkin) void import('./Details');
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
    // the pet's own small news in the person's language, never the server's text (it must never quote memory, P-21)
    if (v.welcome) { const souvenir = welcomeLine(v.now); steps.push([1400, () => e.fire({ type: 'welcomeBack', souvenir })]); }
    if (v.stageUp) {
      const { from, to } = v.stageUp;
      // the stage-up says what it learned (growth.stage.*), on the celebration's beat, even if the engine's cue is lost
      steps.push([1600, () => { setStage(to); e.setLook(v.look, to); e.fire({ type: 'stageUp', from, to }); later(900, () => sayOnce(stageLine(viewRef.current))); }]);
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

  // ready() once the character (and its words) are painted, then hello (or the asleep loop in quiet hours)
  useEffect(() => {
    if (!engine || !stringsOk) return;
    engine.start();
    return readyAfterPaint(tg(), () => {
      helloAt.current = performance.now();
      const care = careRef.current;
      // opened from a check-in (§5.1): its moment plays instead of the hello (Extras' Asks replays it)
      const v = viewRef.current;
      // a check-in's replay or a stage-up is the open event: it is the hello (no "Hi!" first, N-2), and tips and asks
      // wait while it is read (N-1)
      const event = !!(v?.checkin || v?.stageUp) && !care?.asleep;
      const hello = !care?.asleep && !conversationStarted.current && !event;
      if (hello) {
        engine.fire({ type: 'hello', firstName: firstName() });
        // hello first, always (S2): if the engine's line has not landed on its beat (a starved frame loop), say it here
        later(1200, () => { if (!opening.current.hello && !conversationStarted.current) sayOnce(helloText(firstName())); helloSaid(); });
      } else {
        if (event) {
          replayUntil.current = performance.now() + REPLAY_HOLD_MS;
          busyKeys.current.add(BUSY.replay);
          later(REPLAY_HOLD_MS, () => busyKeys.current.delete(BUSY.replay));
        }
        helloSaid();
      }
      // the days chip is the owner's and members' relationship count: a guest never sees it (P-22)
      if (care && v && v.role !== 'guest' && !v.talkInDm) {
        setDays(daysTogether(care.firstMetAt, sync.now()));
      }
      // after the hello has read; an open event that is the hello plays at once
      for (const fn of queued.current.splice(0)) afterHello(hello ? 900 : 150, fn);
      setExtras(true);
      const intent = startIntent();
      // talk: focus the pill (Peek opens it from its round button first)
      if (intent) later(1300, () => intent === 'talk' ? (setTalkOpen(true), setFocusTalk(true)) : onToy(intent === 'feed' ? { type: 'cookieTap' } : { type: 'ballTap' }));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, stringsOk]);


  /* ---------- layout (design §9): class, keyboard, column, character ---------- */

  const measure = useCallback(() => {
    const { w, h, top, bottom, live } = viewport();
    const avail = Math.max(0, h - top - bottom);
    if (fullH.current.w !== w || avail > fullH.current.h) fullH.current = { w, h: avail };
    const kb = typing.current && (live < h - KEYBOARD_PX || avail < fullH.current.h - KEYBOARD_PX);
    const l = layoutOf(w, avail, kb);
    setLayout((p) => (p.cls === l.cls && p.h === l.h && p.kb === l.kb && p.bubble === l.bubble ? p : l));
    setVw((p) => (p === w ? p : w));
    setSafeTop((p) => (p === top ? p : top));
    const dockTop = bottomRef.current?.getBoundingClientRect().top ?? h - 180;
    // Wide: the character stands in the centred column
    const col = l.cls === 'wide' ? Math.min(w, COLUMN_MAX) : w;
    // Regular and Tall: a bigger character on a floor line about two thirds down (the stage is never half empty, P-17)
    const c = characterBox(col, h, top, dockTop, l.h);
    const b = { ...c, x: c.x + Math.round((w - col) / 2) };
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
    // iOS keeps the layout viewport under the keyboard and shrinks only the visual one
    const vv = typeof window !== 'undefined' ? window.visualViewport : undefined;
    vv?.addEventListener?.('resize', measure);
    for (const ev of LAYOUT_EVENTS) app?.onEvent?.(ev, measure);
    return () => {
      offVars();
      window.removeEventListener('resize', measure);
      vv?.removeEventListener?.('resize', measure);
      for (const ev of LAYOUT_EVENTS) app?.offEvent?.(ev, measure);
    };
  }, [mounted, engine, measure]);
  // a new class, room or keyboard moves the dock zone: measure the character again against it. The bottom stack paints
  // only once the view and the strings are in, so whichever of them arrives last measures too (else the box keeps the
  // no-dock estimate and the character can stand over the dock until the next resize)
  const painted = !!bd && stringsOk;
  useLayoutEffect(() => { if (mounted) measure(); }, [mounted, measure, layout.cls, layout.h, layout.kb, room, talkOpen, painted]);

  const onFocusIn = useCallback((e: React.FocusEvent) => {
    if (!(e.target instanceof HTMLInputElement)) return;
    typing.current = true;
    measure();
  }, [measure]);
  const onFocusOut = useCallback((e: React.FocusEvent) => {
    if (!(e.target instanceof HTMLInputElement)) return;
    typing.current = false;
    measure();
  }, [measure]);
  const onSwipe = useCallback((toward: 'left' | 'right') => setRoom((r) => stepToward(r, toward, rtl)), [rtl]);

  // the character changes rooms with the page (design §10.5): the engine's transition, where the engine has it
  const shownRoom = useRef<RoomId>('home');
  useEffect(() => {
    const from = shownRoom.current;
    shownRoom.current = roomRef.current = room;
    if (!engine || from === room) return;
    const forward = ROOM_IDS.indexOf(room) > ROOM_IDS.indexOf(from);
    // in Persian the rail runs right to left, so the slide (and the lean with it) is mirrored
    engine.setRoom?.(room, rtl ? { dir: forward ? -1 : 1 } : {});
    emit({ type: 'room', room });
    // a first visit lights the person's own room moment (§4.11): the server answers noop after that. A check-in's
    // replay (the C5 bloom) is this open's one moment: the room it opens does not light a visit line after it (P-08)
    const replaying = performance.now() < replayUntil.current;
    replayUntil.current = 0;
    if (room !== 'home' && viewRef.current?.play && !replaying) void host.play({ op: 'roomVisited', room });
  }, [engine, room, rtl]); // eslint-disable-line react-hooks/exhaustive-deps
  // the motion layer's cues (settle, lit peak) reach the chunks that wait on them
  useEffect(() => engine?.onMotion?.((cue) => emit({ type: 'motion', cue })), [engine]);  

  /* ---------- page activity, first touch (audio, shake) ---------- */

  useEffect(() => {
    if (!engine) return;
    let stopAccel: (() => void) | null = null;
    let touched = false;

    const first = () => {
      active.current = performance.now();
      touchedOnce();
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

  /** The line on screen now (set with the bubble, so two callers in one frame see it). */
  const shownText = useRef('');
  shownText.current = bubble?.text ?? shownText.current;
  /**
   * A pet line: never over the person's conversation, never blank (P-14), and not again while the same line is on
   * screen (the engine's cue and the page's own call may both say it). True when it shows.
   */
  function sayOnce(text: string): boolean {
    if (!valid() || talkRef.current !== 'idle' || !text.trim() || (bubbleRef.current && shownText.current === text)) return false;
    shownText.current = text;
    bubbleRef.current = true;
    setBubble({ id: performance.now(), text });
    return true;
  }

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
    if (c.type !== 'expr') active.current = performance.now();
    switch (c.type) {
      case 'expr': setExpr(c.expr); break;
      case 'say':
        // Ambient reactions cannot replace the person's current conversation or a late greeting.
        if (c.line === 'hi') { if (!conversationStarted.current && sayOnce(helloText(firstName()))) helloSaid(); }
        // a stage celebration names what it has learned (growth.stage.*), never a bare "I learned something new!"
        else if (c.line === 'learned') sayOnce(stageLine(viewRef.current));
        else sayOnce(sayText(c.line, firstName()));
        break;
      case 'thought': { const need = c.need; setThought(need); later(2400, () => setThought((n) => (n === need ? null : n))); break; }
      case 'care': sync.act(c.action, c.n); emit({ type: 'care', action: c.action }); break;
      // a Bop round in play: no tip or ask over it (N-1)
      case 'score': scoreCut.current = false; busyKeys.current.add(BUSY.round); setScore({ bops: c.bops, misses: c.misses }); break;
      // a round cut by bedtime is already fading: it goes with the fade, not after the round-end beat
      case 'playOver': later(scoreCut.current ? 220 : 1200, () => { busyKeys.current.delete(BUSY.round); setScore(null); }); break;
      case 'spoken': finishSpeaking(speakToken.current); break;
    }
  };

  /* ---------- toys ---------- */

  const onToy = useCallback((t: ToyEvent) => {
    const e = engineRef.current, care = careRef.current;
    if (!e || !valid()) return;
    emit({ type: 'toy', e: t });
    touchedOnce();
    // tucking in ends a Bop round (§4.4): the engine takes the ball away, its pips fade with it (P-02)
    if (t.type === 'moonTap' && !care?.asleep) {
      scoreCut.current = true;
      setScore((s) => (s ? { ...s, out: true } : s));
      // going to sleep: no tip in the same beat (N-1); the key goes when the pet is asleep, or after the bedtime beat
      busyKeys.current.add(BUSY.bedtime);
      later(BEDTIME_MS, () => busyKeys.current.delete(BUSY.bedtime));
    }
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
    conversed();
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
    const q = queue.current;
    queue.current = null;
    if (q) { q.clear(); engineRef.current?.stopSpeaking(); }
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

  /** `streamed`: the sentence queue drives the mouth; the returned synthetic lip-sync runs if no sentence sounds. */
  function speak(reply: string, care?: PetCare, isGoodbye?: boolean, audioB64?: string, bondMilestone?: number, streamed?: boolean) {
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
    if (streamed) return speakText;
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
    const text = isPetError(err) && err.code === 'session_expired' ? t('talk.reopen', undefined, lang)
      : isPetError(err) && err.message === 'voice_unavailable' ? t('talk.micBlocked', undefined, lang) : t('talk.failed', undefined, lang);
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
    conversed();
    startThinking();
    emit({ type: 'typed' });
    try {
      const r: TalkReplyB = await withTimeout((signal) => api.talk(agentId, { text }, { signal }));
      if (!valid()) return false;
      speak(r.reply, r.care, r.goodbye, undefined, r.bondMilestone);
      replied(r, text);
      return true;
    } catch (err) { talkFailed(err); return false; }
  };

  /** A reply landed: the chunks hear whether it saved a note (the growth confirm step, §4.11). */
  const replied = (r: TalkReplyB, said: string) => emit({ type: 'reply', saved: !!(r.savedNote || r.memorySaved) || REMEMBER.test(said), said, moment: r.growthMoment, action: r.action });

  const onVoice = async (blob: Blob, handsFree = false) => {
    if (!valid()) return false;
    conversationStarted.current = true;
    conversed();
    startThinking();
    try {
      // talk-voice?stream=1 (§8A.3, voiceStream.ts): the reply shows on its event, its sentences play in order
      let token = -1;
      const st = api.talkVoiceStream ? await (await import('./voiceStream')).streamTurn({
        call: (on) => withTimeout((signal) => api.talkVoiceStream!(agentId, blob, on, { signal, handsFree })),
        reply: (e) => { if (!valid()) return; const f = speak(e.text, undefined, false, undefined, undefined, true); token = speakToken.current; return f; },
        // `done` brings the care, the goodbye and a milestone; they apply as the reply finishes saying itself
        final: (d) => { if (d.care) sync.adopt(d.care); goodbye.current = !!d.goodbye; milestone.current = d.bondMilestone !== undefined; },
        live: () => valid() && token === speakToken.current,
        ctx: audio,
        mouth: (an) => engineRef.current?.speakAudio(an),
        done: () => { engineRef.current?.stopSpeaking(); finishSpeaking(token); },
        keep: (q) => { queue.current = q; },
      }) : null;
      const streamed = !!st?.streamed;
      const r: TalkVoiceResponse & TalkReplyB = st?.r ?? await withTimeout((signal) => api.talkVoice(agentId, blob, { signal, handsFree }));
      if (!valid()) return;
      // nothing heard (silence, noise): a gentle "try again", never an empty bubble
      if (!r.transcript || !r.reply) {
        if (streamed) return;
        stopWaiting();
        setTalkState('idle');
        setBubble({ id: performance.now(), text: t('talk.didntCatch', undefined, lang) });
        return;
      }
      if (!streamed) speak(r.reply, r.care, r.goodbye, r.audio, r.bondMilestone);
      replied(r, r.transcript);
    } catch (err) { talkFailed(err); }
  };

  const recHold = useRef<(() => void) | null>(null);
  const onRecording = useCallback((on: boolean) => {
    recHold.current?.();
    recHold.current = on ? holdClosing() : null;
    if (on) emit({ type: 'held' });
  }, []);  
  const onMicLevel = useCallback((l: number) => engineRef.current?.micLevel(l), []);
  const onOpenDm = useCallback(() => { const v = viewRef.current; if (v) openDm(v.botUsername); }, []);
  /** Peek: the pill closes back into its round button once the talk field is let go of */
  const onTalkIdle = useCallback(() => { onIdle(); setTalkOpen(false); }, [onIdle]);

  /* ---------- the Wave B host (host.ts): what the lazy chunks borrow ---------- */

  /** A play mutation, adopted into the view (rooms re-read it); null when there is no play record or route, or it failed. */
  async function hostPlay(req: PlayRequest): Promise<PlayResponse | null> {
    if (!api.play || !viewRef.current?.play) return null;
    try {
      const r = await api.play(agentId, req);
      // roomVisited, seasonCelebrated and askAccepted may light a moment: their answer carries the growth view
      patchView(r.growth ? { play: r.play, growth: r.growth } : { play: r.play });
      return r;
    } catch { return null; }
  }
  function patchView(part: Partial<PetViewB>) {
    const v = viewRef.current;
    if (!v || !valid()) return;
    viewRef.current = { ...v, ...part };
    setView(viewRef.current);
    emit({ type: 'view' });
  }
  const live = useRef({ hostPlay, patchView, onVoice, onSend, stopAudio, setTalkState });
  live.current = { hostPlay, patchView, onVoice, onSend, stopAudio, setTalkState };
  bubbleRef.current = !!bubble;
  const host = useMemo<PetHost>(() => ({
    agentId, lang, api, openedAt: performance.now(),
    view: () => viewRef.current, care: () => careRef.current, engine: () => engineRef.current, talk: () => talkRef.current,
    room: () => roomRef.current, setRoom, box: () => boxRef.current, root: () => rootRef.current,
    toy: (k) => toyEls.current[k] ?? null, audio,
    // a pet line never replaces the person's conversation, and a blank one never draws a bubble (P-14)
    say: (text) => sayOnce(text),
    bubbleShown: () => bubbleRef.current,
    act: (a) => sync.act(a),
    toyEvent: (e) => onToy(e),
    play: (req) => live.current.hostPlay(req),
    adoptGrowth: (growth) => live.current.patchView({ growth }),
    patch: (p) => live.current.patchView(p),
    send: (text) => live.current.onSend(text),
    focusTalk: () => { setTalkOpen(true); later(60, () => rootRef.current?.querySelector<HTMLInputElement>('.pet-input')?.focus()); },
    busy: (k, on) => { if (on) busyKeys.current.add(k); else busyKeys.current.delete(k); },
    isBusy: () => busyKeys.current.size > 0,
    lastActive: () => active.current,
    on: (fn) => { bus.current.add(fn); return () => { bus.current.delete(fn); }; },
    emit: (sig) => emit(sig),
    setVoice: (v) => setVoiceUi((p) => ({ ...p, note: undefined, ...v })),
    sendVoice: (b, hf) => { if (talkRef.current !== 'thinking') void live.current.onVoice(b, hf); },
    hush: () => { speakToken.current++; live.current.stopAudio(); if (talkRef.current === 'speaking') live.current.setTalkState('idle'); },
    micOk: (on) => { micOk.current = on; },
  }), [agentId, lang, api, audio, sync, onToy, later, valid]);  
  /** UX-02 before the first hold (P3): a press with no answer yet opens the sheet instead (Extras) */
  const micGate = useCallback(() => {
    const play = viewRef.current?.play;
    const ok = micOk.current ?? !(play && !play.asks.P3?.accepted);
    if (!ok) emit({ type: 'micAsk' });
    return ok;
  }, []);  
  const onHandsFree = useCallback(() => emit({ type: 'handsFree' }), []);  

  const look = view?.look;
  // the body's details, the room keepsakes behind the pet, the garden's pot in front (the Garden room's hero)
  const detailsOn = useMemo(() => (extras && engine && look ? (['body', 'back', 'floor'] as const).map((part) =>
    <Suspense key={part} fallback={null}><Details engine={engine} look={look} stage={stage} size={box.size} part={part} room={part === 'body' ? undefined : room} /></Suspense>) : []), [extras, engine, look, stage, box.size, room]);

  /* ---------- render ---------- */

  if (fatal) {
    return (
      <Suspense fallback={<main className="pet-root" data-pet-root="" style={{ backgroundColor: bd?.edge ?? PET_GROUND }} />}>
        <Sleeper kind={fatal.kind} look={fatal.look} stage={fatal.stage} name={fatal.name} onRetry={fatal.kind === 'offline' || fatal.kind === 'unavailable' ? onRetry : undefined} />
      </Suspense>
    );
  }
  if (!mounted || !view || !bd || !engine || !stringsOk) return <main className="pet-root" data-pet-root="" style={{ backgroundColor: bd?.edge ?? PET_GROUND }} />;

  // the bubble's tail clears what the head wears (a closet head item, the Closet's keepsake bow): N-7
  const g = view.growth, headDressed = !!view.play?.wearing?.head || !!g?.moments.some((m) => m.id === 'room-closet' && (m.lit || g.mine?.includes(m.id)));
  const headTop = box.y + box.size * (headDressed ? 0.13 : 0.2);
  const peek = layout.h === 'peek';
  const guest = view.role === 'guest' || !!view.talkInDm;
  const RoomView = dockRoom === 'home' ? null : ROOM_VIEW[dockRoom];
  // m.* elements with the minimal feature set: the rig only binds MotionValues (no layout, drag or gestures)
  return (
    <LazyMotion features={domMin}>
    <main ref={rootRef} className="pet-root" data-pet-root="" data-tier={tier} data-stage={stage} data-tone={mood?.tone} data-asleep={mood?.asleep ? '' : undefined} data-talk={talk}
      data-layout={layout.cls} data-h={layout.h} data-kb={layout.kb ? '' : undefined} data-room={room} data-talkopen={peek && talkOpen ? '' : undefined} lang={lang} dir={dir(lang)}>
      <Stage engine={engine} backdrop={bd} box={box} reduced={tier === 'reduced'} onSwipe={onSwipe} onBody={() => emit({ type: 'body' })}
        over={<>
          <Particles engine={engine} />
          {/* two zones (P-16): the speech bubble above the head, the thought beside it at head height; when both would
              show, the thought yields */}
          <Thought need={bubble ? null : thought} top={headTop + box.size * 0.03} left={box.x + box.size * 0.84} />
          <Bubble msg={bubble} top={headTop} room={headTop - safeTop} lines={BUBBLE_LINES[layout.bubble]} width={bubbleWidth(vw)}
            x={box.x + box.size / 2} follow={engine.body.x as MotionValue<number>}
            onGone={(id) => setBubble((b) => (b?.id === id ? null : b))} onHold={() => emit({ type: 'bubbleHold' })} />
          {days !== null && !guest && <div className="pet-days" style={{ top: box.y + box.size * 0.9 }} onAnimationEnd={() => setDays(null)}>{daysTogetherText(days)}</div>}
          {/* Bop's round as pips, never a digit (§4.2); bedtime fades them out with the round */}
          {score && <div className="pet-score" data-out={score.out ? '' : undefined} role="img" aria-label={t('play.starfall.pips', undefined, lang)}>{Array.from({ length: 10 }, (_, i) => <i key={i} data-on={i < score.bops ? '' : undefined} />)}</div>}
        </>}>
        <PetRig engine={engine} look={view.look} stage={stage} size={box.size} label={view.name} expr={expr} overlay={detailsOn[0]} back={detailsOn[1]} floor={detailsOn[2]} />
      </Stage>
      <div className="pet-bottom" ref={bottomRef} onFocus={onFocusIn} onBlur={onFocusOut}>
        <RoomRail room={room} onRoom={setRoom} rtl={rtl} vertical={layout.cls === 'wide'} />
        <div className="pet-row">
          {/* one boundary, always mounted: a room chunk that is still loading keeps the shown dock (a deferred render) */}
          <div className="pet-panel" role="tabpanel" id={ROOM_PANEL_ID} aria-labelledby={roomTabId(dockRoom)} data-stale={dockRoom !== room ? '' : undefined}>
            <Suspense fallback={<div className="pet-soon" />}>{RoomView ? <RoomView id={dockRoom as Exclude<RoomId, 'home'>} host={host} asleep={!!mood?.asleep} view={view} />
              : <Dock needs={needs} onToy={onToy} toyRef={toyRef} />}</Suspense>
          </div>
          {peek && <button type="button" className="pet-toy pet-talkbtn" aria-label={t('toy.talk', undefined, lang)} aria-expanded={talkOpen}
            onClick={() => (guest ? onOpenDm() : setTalkOpen(true))}><span className="pet-toy-face"><TalkIcon /></span></button>}
        </div>
        {(!peek || talkOpen) && <div ref={pillRef}>
          <TalkPill name={view.name} guest={guest} onOpenDm={onOpenDm} busy={talk === 'thinking'}
            onListen={onListen} onIdle={peek ? onTalkIdle : onIdle} onTypingPause={onTypingPause} onSend={onSend}
            onVoice={view.listen !== false ? (b) => void onVoice(b) : undefined} onMicLevel={onMicLevel} onRecording={onRecording} audioContext={audio} autoFocus={focusTalk || (peek && talkOpen)}
            micGate={micGate} voice={voice} onHandsFree={onHandsFree} />
        </div>}
      </div>
      {extras && <Suspense fallback={null}><Extras host={host} /></Suspense>}
      {code && api.send && <Suspense fallback={null}><Circle api={api} agentId={agentId} code={code} onJoy={(why) => whenAwake(() => engineRef.current?.fire({ type: 'celebrate', why }))} /></Suspense>}
    </main>
    </LazyMotion>
  );
}

/** Peek's talk button: a speech bubble (the pill opens from it). */
function TalkIcon() {
  return (
    <svg className="pet-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 6.5A2.5 2.5 0 0 1 7.5 4h9A2.5 2.5 0 0 1 19 6.5v6a2.5 2.5 0 0 1-2.5 2.5H11l-4 3.5V15h0A2.5 2.5 0 0 1 5 12.5z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}
