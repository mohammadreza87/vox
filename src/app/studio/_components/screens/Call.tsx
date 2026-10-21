'use client';

import { AnimatePresence, motion, useMotionValue, useSpring, useTransform, type MotionValue } from 'framer-motion';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { api, haptic, tg, type AgentView } from '../../_lib/client';
import { callCopy } from '../../_lib/call-copy';
import { formatClock, type Locale } from '../../_lib/i18n';
import { DUR, EASE } from '../../_lib/motion';
import { pageActive } from '../motion/activity';
import { Ticker } from '../motion/Ticker';
import { useTier } from '../motion/tier';
import { useLanded } from '../motion/useLanded';
import { syllables } from '../character/rig';
import { learningApi } from '../../_lib/learning-client';
import { preferenceLearningApi } from '../../_lib/preference-learning-client';
import type { ClientObservationInput } from '@/lib/adaptive/observation/contracts';
import { predictionHttpTransport } from '@/lib/adaptive/prediction/client';
import { VoicePartialConsumer, type VoicePartialCapability } from '@/lib/adaptive/prediction/voice-client';
import { VoicePreparationPanel } from '../VoicePreparationPanel';
import { TaskOutcome } from '../TaskOutcome';
import { Cloud, PALETTE, stageFor, type CloudMoment, type Expression } from '../Cloud';
import { errorMessage, LoadingFill, useNav } from '../StudioApp';
import { Banner, hueVars, Icon, Section, Seg, Sheet, SheetHead, TopBar } from '../ui';

type Phase = 'ready' | 'listening' | 'thinking' | 'speaking';
type Space = 'work' | 'personal';
type LiveSession = { endSession(): Promise<void>; setMicMuted(muted: boolean): void; getInputVolume(): number; getOutputVolume?(): number };
interface Line { who: 'you' | 'agent'; text: string }

const EXPR: Record<Phase, Expression> = { ready: 'idle', listening: 'listening', thinking: 'thinking', speaking: 'speaking' };
const LAND: CloudMoment = { kind: 'perk', key: 'land' };
/** Hang-up's "bye" nod (motion §3.3); the screen pops once it ends, or after this at the latest. */
const BYE: CloudMoment = { kind: 'nod', key: 'bye' };
const BYE_MS = 350;
/** Board waveform: 32 bars, 10–36 px, a fixed silhouette the level scales. */
const BARS = Array.from({ length: 32 }, (_, i) => (10 + 26 * Math.abs(Math.sin(i * 1.7) * Math.cos(i * 0.6))) / 36);
/** Speech envelope resolution for tap-to-talk replies (frames per second). */
const ENV_HZ = 60;

/** The only part of the call that ticks every second, so the screen itself doesn't re-render. */
function CallClock({ since, locale }: { since: number; locale: Locale }) {
  const [now, setNow] = useState(since);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [since]);
  return <Ticker value={formatClock(Math.max(0, Math.floor((now - since) / 1000)), locale)} quick />;
}

/**
 * 32-bar waveform (board 1-1-call): follows whoever is talking, freezes while thinking, lies flat
 * when idle. It writes bar transforms straight from the level MotionValue, never through React.
 */
function Wave({ level, phase }: { level: MotionValue<number>; phase: Phase }) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useTier() === 'reduced';
  useEffect(() => {
    const bars = ref.current ? [...ref.current.children] as HTMLElement[] : [];
    const moving = (phase === 'listening' || phase === 'speaking') && !reduced;
    const draw = (v: number) => {
      const t = performance.now() / 1000, amp = Math.min(1, v * 2.4);
      bars.forEach((b, i) => {
        const h = moving ? 0.12 + 0.88 * amp * BARS[i] * (0.62 + 0.38 * Math.sin(t * 9 + i * 1.7)) : phase === 'ready' ? 0.12 : BARS[i] * 0.5;
        b.style.transform = `scaleY(${h.toFixed(3)})`;
      });
    };
    if (phase !== 'thinking') draw(level.get());
    if (!moving) return;
    return level.on('change', draw);
  }, [level, phase, reduced]);
  return (
    <div ref={ref} className="vx-wave vx-call-wave" data-phase={phase} aria-hidden="true">
      {BARS.map((_, i) => <span key={i} />)}
    </div>
  );
}

/** RMS envelope of a reply (base64 MP3) decoded offline: drives lip-sync from playback time, never re-routes the audio. */
async function speechEnvelope(b64: string): Promise<Float32Array | null> {
  try {
    const w = window as unknown as { OfflineAudioContext?: typeof OfflineAudioContext; webkitOfflineAudioContext?: typeof OfflineAudioContext };
    const Ctx = w.OfflineAudioContext ?? w.webkitOfflineAudioContext;
    if (!Ctx) return null;
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const ctx = new Ctx(1, 1, 22050);
    // older WebKit only has the callback form
    const audio = await new Promise<AudioBuffer>((resolve, reject) => {
      const p = ctx.decodeAudioData(bytes.buffer, resolve, reject) as Promise<AudioBuffer> | undefined;
      p?.then?.(resolve, reject);
    });
    const data = audio.getChannelData(0), win = Math.max(1, Math.round(audio.sampleRate / ENV_HZ));
    const env = new Float32Array(Math.ceil(data.length / win));
    for (let i = 0; i < env.length; i++) {
      let sum = 0;
      const a = i * win, b = Math.min(data.length, a + win);
      for (let j = a; j < b; j++) sum += data[j] * data[j];
      env[i] = Math.sqrt(sum / Math.max(1, b - a));
    }
    return env;
  } catch { return null; }
}

function pickMime(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  for (const t of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return '';
}

const useCallSize = () => useState(() => (typeof window !== 'undefined' && window.innerHeight < 720 ? 200 : 260))[0];

export function CallScreen({ id }: { id: string }) {
  const nav = useNav();
  const locale: Locale = nav.locale ?? 'en';
  const c = callCopy[locale];
  const [agent, setAgent] = useState<AgentView | null>(() => nav.cache?.get(id) ?? null);
  const [phase, setPhase] = useState<Phase>('ready');
  const phaseRef = useRef<Phase>('ready');
  phaseRef.current = phase;
  const [lines, setLines] = useState<Line[]>([]);
  const [captions, setCaptions] = useState(true);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [options, setOptions] = useState(false);
  const [summary, setSummary] = useState(false);
  const [micDenied, setMicDenied] = useState(false);
  const cloudSize = useCallSize();
  // The face perks once it has landed from the profile (not mid-flight), and nods "bye" before the pop (motion §3.3).
  const callRef = useRef<HTMLDivElement>(null);
  const landed = useLanded(callRef);
  const [bye, setBye] = useState(false);
  const leaving = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (leaving.current) clearTimeout(leaving.current); }, []);
  /** Pops once, whichever comes first: the nod's end or its timeout. */
  const leave = () => {
    if (!leaving.current) return;
    clearTimeout(leaving.current);
    leaving.current = null;
    nav.back();
  };
  // Audio level 0..1 per frame: the mic while listening, the voice while speaking. MotionValues only (P1).
  const level = useMotionValue(0);
  const listening = useMotionValue(0);
  // Reduced motion: no live motion (motion §8). The mic ring and glow stay put; ringOpacity still says "listening".
  const tier = useTier();
  const live01 = useMotionValue(tier === 'reduced' ? 0 : 1);
  useEffect(() => { live01.set(tier === 'reduced' ? 0 : 1); }, [tier, live01]);
  const heard = useSpring(useTransform(() => level.get() * listening.get() * live01.get()), { stiffness: 400, damping: 20 });
  const glowScale = useTransform(heard, (v) => 1 + v * 0.25);
  const ringScale = useTransform(heard, (v) => 1 + ((6 + v * 18) * 2) / 84);
  const ringOpacity = useSpring(listening, { stiffness: 300, damping: 30 });
  useEffect(() => { listening.set(phase === 'listening' ? 1 : 0); }, [phase, listening]);
  // Space is app-level (D17); the call keeps a local copy so a switch resets the session at once.
  const [space, setSpaceLocal] = useState<Space>(nav.space ?? 'work');
  useEffect(() => { if (nav.space) setSpaceLocal(nav.space); }, [nav.space]);
  const [partialCapability, setPartialCapability] = useState<VoicePartialCapability>();
  const [prepareWhileSpeaking, setPrepareWhileSpeaking] = useState(false);
  const [feedbackTurnId, setFeedbackTurnId] = useState<string | null>(null);
  const partial = useRef<VoicePartialConsumer | null>(null);
  useEffect(() => () => { void preferenceLearningApi.cancel(space, id); }, [id, space]);
  const changePreparation = (value: boolean) => {
    partial.current?.setOptIn(value);
    setPrepareWhileSpeaking(value && partialCapability?.available === true);
  };

  const stream = useRef<MediaStream | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const player = useRef<HTMLAudioElement | null>(null);
  const audioCtx = useRef<AudioContext | null>(null);
  const cancelled = useRef(false);
  const generation = useRef(0);
  const playback = useRef<{ agentId: string; space: Space; turnId: string; generation: number; requestedAt: number; outcomes: Set<ClientObservationInput['outcome']> } | null>(null);
  const clearPlayback = () => {
    playback.current = null;
    if (player.current) {
      player.current.onplaying = null; player.current.onended = null; player.current.onerror = null;
      player.current.pause();
    }
  };
  const reportPlayback = (outcome: ClientObservationInput['outcome']) => {
    const turn = playback.current;
    if (!turn || !turn.turnId || turn.generation !== generation.current || cancelled.current || turn.outcomes.has(outcome)) return;
    turn.outcomes.add(outcome);
    // Optional evidence must never affect the call, including when reporting is unavailable.
    try { void learningApi.event({ eventId: crypto.randomUUID(), agentId: turn.agentId, space: turn.space, turnId: turn.turnId, outcome,
      durationMs: Math.min(86_400_000, Math.max(0, performance.now() - turn.requestedAt)) }).catch(() => undefined); }
    catch { /* best effort */ }
  };
  // Live mode: ElevenLabs streams both ways and handles turn-taking.
  const [live, setLive] = useState(false);
  const [muted, setMuted] = useState(false);
  const micMuted = useRef(false);
  const session = useRef<LiveSession | null>(null);
  const liveUnavailable = useRef(false);
  const liveGeneration = useRef(0);

  /* ---- one meter loop: the mic while listening, the voice while speaking (live volume, the reply's envelope, or syllables) ---- */
  const mic = useRef<(() => number) | null>(null);
  const voice = useRef<(() => number | null) | null>(null);
  const envelope = useRef<Float32Array | null>(null);
  const meterRaf = useRef(0);
  const startMeter = (current: number) => {
    if (meterRaf.current) return;
    let last = performance.now(), t = 0;
    const tick = (now: number) => {
      if (cancelled.current || generation.current !== current) { meterRaf.current = 0; return; }
      const p = phaseRef.current;
      // nothing to meter and the level has decayed: rest until a phase change restarts the loop
      if (p !== 'listening' && p !== 'speaking' && level.get() <= 0.002) { level.set(0); meterRaf.current = 0; return; }
      meterRaf.current = requestAnimationFrame(tick);
      const dt = Math.min(64, Math.max(0, now - last));
      last = now;
      if (!pageActive()) return;
      if (p === 'listening') level.set(mic.current?.() ?? 0);
      else if (p === 'speaking') { t += dt / 1000; level.set(voice.current?.() ?? syllables(t) * 0.32); }
      else if (level.get() > 0.002) level.set(level.get() * 0.85);
    };
    meterRaf.current = requestAnimationFrame(tick);
  };
  const stopMeter = () => { if (meterRaf.current) cancelAnimationFrame(meterRaf.current); meterRaf.current = 0; };
  // the loop rests while nothing is metered; listening or speaking wakes it (once a source exists; startMeter is idempotent)
  useEffect(() => {
    if ((phase === 'listening' || phase === 'speaking') && (mic.current || voice.current) && !cancelled.current) startMeter(generation.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  /** Stops everything the call holds (recorder, mic, meters, playback) and invalidates in-flight work. Idempotent. */
  const teardown = (current: number) => {
    if (playback.current?.outcomes.has('playback_started')) reportPlayback('interrupted');
    cancelled.current = true;
    generation.current = current + 1;
    clearPlayback();
    if (recorder.current?.state === 'recording') recorder.current.stop();
    stream.current?.getTracks().forEach((tr) => tr.stop());
    stopMeter();
    void audioCtx.current?.close().catch(() => undefined);
    recorder.current = null; stream.current = null; audioCtx.current = null; mic.current = null; voice.current = null;
    void endLive();
  };

  useEffect(() => {
    // Reset on (re)mount: React StrictMode runs this effect's cleanup once in dev.
    cancelled.current = false;
    const current = ++generation.current;
    const active = () => !cancelled.current && generation.current === current;
    if (agent?.id !== id) setAgent(nav.cache?.get(id) ?? null);
    setPhase('ready'); setLines([]); setLive(false); liveUnavailable.current = false; setStartedAt(null); setMicDenied(false);
    setFeedbackTurnId(null); setPrepareWhileSpeaking(false); setPartialCapability(undefined); setSummary(false);
    micMuted.current = false; setMuted(false);
    api.agent(id).then((r) => { if (active()) { nav.cache?.set(id, r.agent); setAgent(r.agent); } })
      .catch((e) => { if (active()) { nav.toast(errorMessage(e), 'error'); nav.back(); } });
    // Navigation can unmount the screen without the explicit hang-up handler.
    // Record only audio that actually started, while its captured turn is valid.
    return () => teardown(current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, space]);

  const ensureStream = async (current: number) => {
    if (stream.current) return stream.current;
    const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    if (cancelled.current || generation.current !== current) { s.getTracks().forEach(tr => tr.stop()); return null; }
    stream.current = s;
    try {
      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      ctx.createMediaStreamSource(s).connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      audioCtx.current = ctx;
      mic.current = () => { analyser.getByteFrequencyData(data); return Math.min(1, data.reduce((a, b) => a + b, 0) / data.length / 128); };
    } catch { /* the level is decorative */ }
    voice.current = () => {
      const env = envelope.current, p = player.current;
      return env && p ? Math.min(1, (env[Math.floor(p.currentTime * ENV_HZ)] ?? 0) * 1.6) : null;
    };
    startMeter(current);
    return s;
  };

  const start = async () => {
    const current = generation.current;
    const turnAgentId = id; const turnSpace = space;
    setFeedbackTurnId(null);
    // A user gesture unlocks playback for the replies that follow.
    if (!player.current) { player.current = new Audio(); player.current.play().catch(() => undefined); }
    try {
      const s = await ensureStream(current);
      if (!s || cancelled.current || generation.current !== current) return;
      const mime = pickMime();
      const rec = new MediaRecorder(s, mime ? { mimeType: mime } : undefined);
      const recordedChunks: Blob[] = [];
      rec.ondataavailable = (e) => { if (e.data.size) recordedChunks.push(e.data); };
      rec.onstop = () => { if (!cancelled.current && generation.current === current) void send(new Blob(recordedChunks, { type: rec.mimeType || mime || 'audio/webm' }), turnAgentId, turnSpace, current); };
      rec.start();
      recorder.current = rec;
      haptic.light();
      setMicDenied(false);
      setStartedAt((t) => t ?? Date.now());
      setPhase('listening');
    } catch {
      if (cancelled.current || generation.current !== current) return;
      haptic.error();
      setMicDenied(true);
    }
  };

  const send = async (blob: Blob, turnAgentId: string, turnSpace: Space, current: number) => {
    const active = () => !cancelled.current && generation.current === current;
    if (!active()) return;
    if (blob.size < 2000) { setPhase('ready'); return; }
    setPhase('thinking');
    try {
      const requestedAt = performance.now();
      const r = await api.callTurn(turnAgentId, blob, turnSpace);
      if (!active()) return;
      if (!r.transcript) { nav.toast(c.didntCatch); setPhase('ready'); return; }
      setLines((l) => [...l, { who: 'you', text: r.transcript }, { who: 'agent', text: r.reply }]);
      setFeedbackTurnId(r.turnId ?? null);
      if (r.audio && player.current) {
        clearPlayback();
        const p = player.current;
        const turn = { agentId: turnAgentId, space: turnSpace, turnId: r.turnId ?? '', generation: current, requestedAt, outcomes: new Set<ClientObservationInput['outcome']>() };
        playback.current = turn;
        const currentPlayback = () => active() && player.current === p && playback.current === turn;
        envelope.current = null;
        void speechEnvelope(r.audio).then((env) => { if (currentPlayback()) envelope.current = env; });
        p.onplaying = () => { if (currentPlayback()) reportPlayback('playback_started'); };
        p.onended = () => { if (currentPlayback()) { reportPlayback('playback_completed'); clearPlayback(); setPhase('ready'); } };
        p.onerror = () => { if (currentPlayback()) { reportPlayback('playback_failed'); clearPlayback(); setPhase('ready'); } };
        p.src = `data:audio/mpeg;base64,${r.audio}`;
        setPhase('speaking');
        await p.play().catch(() => { if (currentPlayback()) { reportPlayback('playback_failed'); clearPlayback(); setPhase('ready'); } });
      } else {
        setPhase('ready');
      }
    } catch (e) {
      if (!active()) return;
      haptic.error();
      nav.toast(errorMessage(e), 'error');
      setPhase('ready');
    }
  };

  async function endLive() {
    liveGeneration.current++;
    partial.current?.dispose(); partial.current = null;
    const s = session.current;
    if (!s) return;
    session.current = null;
    await s.endSession().catch(() => undefined);
    void api.callEnd(id, space).catch(() => undefined);
  }

  /** Opens a live call; returns false when the server only supports tap-to-talk. */
  const startLive = async (): Promise<boolean> => {
    if (liveUnavailable.current) return false;
    const current = generation.current;
    const liveEpoch = ++liveGeneration.current;
    const active = () => !cancelled.current && generation.current === current && liveGeneration.current === liveEpoch;
    setPhase('thinking');
    try {
      const call = await api.liveCall(id, space);
      if (!active()) return true;
      if (!call.live) { liveUnavailable.current = true; setPhase('ready'); return false; }
      partial.current?.dispose();
      const voicePartial = new VoicePartialConsumer({ ...predictionHttpTransport(() => tg()?.initData ?? ''),
        agentId: id, space, sessionId: crypto.randomUUID(), capability: call.partialPrediction });
      partial.current = voicePartial;
      micMuted.current = false; setMuted(false);
      setPartialCapability(call.partialPrediction); setPrepareWhileSpeaking(false); setFeedbackTurnId(null);
      await navigator.mediaDevices.getUserMedia({ audio: true }).then((s) => s.getTracks().forEach((t) => t.stop()));
      if (!active()) return true;
      const { Conversation } = await import('@elevenlabs/client');
      if (!active()) return true;
      const conv = await Conversation.startSession({
        signedUrl: call.signedUrl,
        customLlmExtraBody: { call: call.callToken },
        overrides: { agent: { firstMessage: call.firstMessage, ...(call.language ? { language: call.language as never } : {}) }, tts: { voiceId: call.voiceId } },
        onModeChange: ({ mode }) => { if (active()) { voicePartial.setListening(mode === 'listening' && !micMuted.current); setPhase(mode === 'speaking' ? 'speaking' : 'listening'); } },
        onDebug: event => { if (active()) voicePartial.onDebug(event); },
        onInterruption: () => { if (active()) voicePartial.cancel(); },
        onMessage: ({ message, role }) => { if (active()) {
          if (role === 'user') voicePartial.finishTurn();
          if (message.trim()) setLines((l) => [...l, { who: role === 'user' ? 'you' : 'agent', text: message }]);
        } },
        onError: (message) => { if (active()) { voicePartial.dispose(); setPartialCapability(undefined); setPrepareWhileSpeaking(false); nav.toast(message || c.dropped, 'error'); } },
        onDisconnect: () => { if (active()) { voicePartial.dispose(); setPartialCapability(undefined); setPrepareWhileSpeaking(false);
          if (session.current) { session.current = null; setLive(false); setPhase('ready'); void api.callEnd(id, space).catch(() => undefined); }
        } },
      }) as unknown as LiveSession;
      if (!active()) { await conv.endSession(); return true; }
      session.current = conv;
      mic.current = () => Math.min(1, (session.current?.getInputVolume() ?? 0) * 2);
      voice.current = () => (session.current?.getOutputVolume ? Math.min(1, session.current.getOutputVolume() * 1.6) : null);
      setLive(true);
      setMicDenied(false);
      setStartedAt(Date.now());
      setPhase('listening');
      haptic.success();
      startMeter(current);
      return true;
    } catch (e) {
      if (!active()) return true;
      partial.current?.dispose(); setPartialCapability(undefined); setPrepareWhileSpeaking(false);
      haptic.error();
      if (e instanceof DOMException) setMicDenied(true); else nav.toast(errorMessage(e), 'error');
      setPhase('ready');
      return true;
    }
  };

  const toggleMute = () => {
    if (!session.current) return;
    haptic.select();
    const next = !micMuted.current;
    session.current.setMicMuted(next); micMuted.current = next;
    partial.current?.setListening(!next && phase === 'listening');
    setMuted(next);
  };

  const tap = () => {
    if (live) {
      if (session.current) toggleMute();
      else void startLive();
      return;
    }
    if (phase === 'ready') void startLive().then((handled) => { if (!handled && !cancelled.current) void start(); });
    else if (phase === 'listening') { haptic.soft(); recorder.current?.stop(); }
    else if (phase === 'speaking') { reportPlayback('interrupted'); clearPlayback(); setPhase('ready'); void start(); }
  };

  /** End (D17: there is no minimise until the call lives at app level). A tap-to-talk turn asks how it went first. */
  const hangUp = () => {
    haptic.heavy();
    reportPlayback('interrupted');
    clearPlayback();
    const ask = !!feedbackTurnId && !live;
    teardown(generation.current);
    setPhase('ready');
    if (ask) { setSummary(true); return; }
    if (tier === 'reduced') { nav.back(); return; }
    if (leaving.current) return;
    setBye(true);
    leaving.current = setTimeout(leave, BYE_MS);
  };

  const changeSpace = (s: Space) => {
    if (s === space) return;
    setSpaceLocal(s);
    nav.setSpace?.(s);
  };

  if (!agent) return <><TopBar lead="close" onLead={nav.back} /><LoadingFill /></>;
  const pal = PALETTE[agent.look.hue] ?? PALETTE.lilac;
  const name = agent.persona.name;
  const connected = live && !!session.current;
  const last = lines[lines.length - 1];
  const status = phase === 'listening' ? (connected && muted ? c.muted : c.listening)
    : phase === 'thinking' ? (connected || !liveUnavailable.current ? c.connecting : c.thinking)
      : phase === 'speaking' ? c.speaking(name) : connected ? c.connected : c.ready;
  const dot = phase === 'listening' && !(connected && muted) ? 'var(--success)' : phase === 'thinking' ? 'var(--warn)' : phase === 'speaking' ? 'var(--hue)' : 'var(--text-3)';
  const hint = connected ? (muted ? c.mutedHint : c.liveHint[phase]) : live ? c.liveHint[phase] : c.hint[phase];
  const inSession = !!session.current || phase !== 'ready';
  const pulse = phase === 'speaking' && tier === 'full';

  return (
    <div ref={callRef} className="vx-call" style={hueVars(pal)}>
      {/* Board glow: a static radial; the voice swells it, speech breathes it. Transform + opacity only, no filter (P6) */}
      {/* The speech pulse is full tier only (motion §7 P14: lite drops the glow pulse; reduced has no live motion) */}
      <motion.div aria-hidden="true" className="vx-call-glow" animate={{ scale: pulse ? [1, 1.08, 1] : 1, opacity: phase === 'ready' ? 0.7 : 1 }}
        transition={pulse ? { duration: 1.4, repeat: Infinity, ease: EASE.sine } : { duration: DUR.medium, ease: EASE.standard }}>
        <motion.div style={{ width: '100%', height: '100%', borderRadius: '50%', scale: glowScale, background: `radial-gradient(closest-side, ${pal.glow}42, ${pal.glow}00)` }} />
      </motion.div>

      <TopBar lead="close" onLead={hangUp} leadLabel={c.closeCall} title={name}
        subtitle={<span className="vx-num">{agent.persona.role} · {c.spaces[space]}{startedAt !== null && <> · <CallClock since={startedAt} locale={locale} /></>}</span>}
        end={(
          <span className="vx-call-end">
            {connected && <span className="vx-call-signal" title={c.connected}><Icon name="signal" size={20} /></span>}
            <button type="button" className="vx-icon-btn" aria-label={c.options} onClick={() => setOptions(true)}><Icon name="more" /></button>
          </span>
        )} />

      <div className="vx-call-stage">
        <div className="vx-call-face">
          <Cloud look={agent.look} size={cloudSize} expr={EXPR[phase]} stage={agent.stage ?? stageFor(agent.formingDay, agent.status)}
            label={name} heroId={agent.id} level={level} moment={bye ? BYE : landed ? LAND : null} glow={0.3}
            onMomentEnd={(k) => { if (k === 'nod') leave(); }} />
        </div>
        <div className="vx-status" aria-live="polite" style={{ '--status': dot } as CSSProperties}>
          <span className="vx-status-dot" />
          <AnimatePresence initial={false} mode="popLayout">
            <motion.span key={status} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: DUR.fast, ease: EASE.standard }}>{status}</motion.span>
          </AnimatePresence>
        </div>
        <p className="vx-call-hint" aria-live="polite">{hint}</p>
        <Wave level={level} phase={phase} />
        {micDenied && (
          <div className="vx-call-banner">
            <Banner tone="warn" icon="mic" action={<button type="button" className="vx-btn vx-btn-sm vx-btn-secondary" onClick={() => { setMicDenied(false); tap(); }}>{c.tryAgain}</button>}>
              {c.micDenied}
            </Banner>
          </div>
        )}
        <AnimatePresence initial={false} mode="popLayout">
          {captions && last && (
            <motion.div key={lines.length} className="vx-caption vx-call-caption" style={{ '--who': last.who === 'agent' ? 'var(--hue-light)' : 'var(--text-2)' } as CSSProperties}
              initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: DUR.base, ease: EASE.enter }}>
              <span className="vx-caption-who">{last.who === 'agent' ? name : c.you}</span>
              <p dir="auto">{last.text}</p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="vx-ctrls" data-snack-anchor>
        {connected ? (
          <button type="button" className="vx-ctrl" aria-label={muted ? c.unmute : c.mute} aria-pressed={muted} onClick={tap}>
            <Icon name={muted ? 'micOff' : 'mic'} size={24} />
          </button>
        ) : null}
        <button type="button" className="vx-ctrl" aria-label={c.captions} aria-pressed={captions} onClick={() => { haptic.select(); setCaptions((c) => !c); }}>
          <Icon name="captions" size={24} />
        </button>
        {!connected && (
          <span className="vx-call-talk">
            {/* Mic ring: one transformed element instead of an animated box-shadow (P4) */}
            <motion.span aria-hidden="true" className="vx-call-ring" style={{ scale: ringScale, opacity: ringOpacity }} />
            <motion.button type="button" onClick={tap} disabled={phase === 'thinking'} className="vx-call-mic" data-on={phase === 'listening' || undefined}
              aria-label={phase === 'listening' ? c.send : c.talk} whileTap={{ scale: 0.92 }}>
              <Icon name={phase === 'listening' ? 'send' : 'mic'} size={32} width={2} />
            </motion.button>
          </span>
        )}
        <button type="button" className="vx-ctrl vx-ctrl-end" aria-label={c.end} onClick={hangUp}>
          <Icon name="end" size={28} width={2} style={{ transform: 'rotate(135deg)' }} />
        </button>
      </div>

      <Sheet open={options} onClose={() => setOptions(false)} label={c.options}>
        <SheetHead title={c.options} sub={`${name} · ${agent.persona.role}`} />
        <Section plain title={c.space} foot={inSession ? c.endToSwitch : c.spaceFoot}>
          <div>
            <Seg label={c.conversationSpace} value={space} disabled={inSession}
              options={[{ value: 'work', label: c.spaces.work }, { value: 'personal', label: c.spaces.personal }]}
              onChange={(s) => changeSpace(s as Space)} />
          </div>
        </Section>
        <VoicePreparationPanel capability={partialCapability} enabled={prepareWhileSpeaking} onChange={changePreparation} locale={locale} />
      </Sheet>

      <Sheet open={summary} onClose={() => nav.back()} label={c.ended}
        dock={<button type="button" className="vx-btn vx-btn-primary vx-btn-block" onClick={() => nav.back()}>{c.done}</button>}>
        <SheetHead title={c.ended} sub={`${name} · ${agent.persona.role}`} />
        {feedbackTurnId && <TaskOutcome key={`${id}:${space}:${feedbackTurnId}`} agentId={id} space={space} turnId={feedbackTurnId} locale={locale} />}
      </Sheet>
    </div>
  );
}
